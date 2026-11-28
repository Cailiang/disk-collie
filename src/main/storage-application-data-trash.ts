import path from 'node:path'
import os from 'node:os'
import {mkdir,mkdtemp,rmdir} from 'node:fs/promises'
import {lstat} from './physical-fs'
import type {AppLanguage} from '../shared/app-settings'
import {translate} from '../shared/localization'
import {command,shellQuote} from './startup/common'

// Darwin's SYS_renameatx_np=488 and RENAME_EXCL=4 are defined by sys/syscall.h
// and sys/stdio.h. Pinned directory descriptors prevent ancestor substitution;
// exclusive rename never copies across volumes or overwrites a destination.
export const applicationDataMoveProgram=String.raw`
BEGIN { @INC=grep {m{^/System/Library/Perl/}} @INC; }
use strict; use warnings; use Digest::SHA; use Time::HiRes (); use Fcntl qw(:mode);
my ($mode,$parent,$name,$parentStamp,$expected,$destinationParent,$destinationName,$destinationStamp,$uid)=@ARGV;
sub stamp {my @s=@_; return join(':',@s[0,1,2,4,5]);}
opendir(my $sourceDir,$parent) or die "directory changed\n";
my @parentStat=stat($sourceDir); die "directory changed\n" unless stamp(@parentStat) eq $parentStamp;
die "directory changed\n" if !$name || $name eq '.' || $name eq '..' || $name=~m{/};
chdir($sourceDir) or die "directory changed\n";
my @root=Time::HiRes::lstat($name); die "directory changed\n" unless @root && S_ISDIR($root[2]) && !S_ISLNK($root[2]);
my $hash=Digest::SHA->new(256); my $count=0;
sub frame {my ($s)=@_;$hash->add(pack('N',length($s)),$s);}
sub walk {
 my ($name,$relative,$depth)=@_; die "directory incomplete\n" if ++$count>500000 || $depth>512;
 my @s=Time::HiRes::lstat($name); die "directory changed\n" unless @s && $s[0]==$root[0];
 frame($relative); frame(join(':',@s[0,1,2,3,4,5,6,7])); $hash->add(pack('d2',@s[9,10]));
 if(S_ISLNK($s[2])) {my $link=readlink($name);die "directory changed\n" unless defined $link;frame($link);}
 elsif(S_ISDIR($s[2])) {
  opendir(my $dir,$name) or die "directory incomplete\n";my @opened=stat($dir);
  die "directory changed\n" unless $opened[0]==$s[0] && $opened[1]==$s[1];
  my @names=sort grep {$_ ne '.' && $_ ne '..'} readdir($dir);
  opendir(my $back,'.') or die "directory changed\n";chdir($dir) or die "directory changed\n";
  for my $child (@names) {walk($child,$relative.'/'.$child,$depth+1);}
  chdir($back) or die "directory changed\n";closedir($back);closedir($dir);
 } elsif(!S_ISREG($s[2])) {die "directory changed\n";}
}
walk($name,'.',0);my $digest=$hash->hexdigest;
if($mode eq 'digest') {print $digest;exit 0;}
die "directory changed\n" unless $mode eq 'move' && $digest eq $expected;
opendir(my $destinationDir,$destinationParent) or die "destination changed\n";
my @dest=stat($destinationDir);
die "destination changed\n" unless stamp(@dest) eq $destinationStamp && $dest[0]==$root[0] && $dest[4]==$uid && ($dest[2]&0777)==0700;
die "destination changed\n" if !$destinationName || $destinationName eq '.' || $destinationName eq '..' || $destinationName=~m{/};
my @fresh=Time::HiRes::lstat($name);die "directory changed\n" unless @fresh && $fresh[0]==$root[0] && $fresh[1]==$root[1] && S_ISDIR($fresh[2]);
my $sourceName="".$name;my $targetName="".$destinationName;
my $result=syscall(488,fileno($sourceDir),$sourceName,fileno($destinationDir),$targetName,4);
die "move failed: $!\n" if $result!=0;
print "DiskCollieApplicationDataMoved\n";
`
const elevation=String.raw`on run argv
do shell script (item 1 of argv) with administrator privileges with prompt (item 2 of argv)
end run`
const statStamp=(s:Awaited<ReturnType<typeof lstat>>):string=>[s.dev,s.ino,s.mode,s.uid,s.gid].join(':')
async function nonLinkedAncestors(target:string):Promise<void>{for(let p=target;;p=path.dirname(p)){if((await lstat(p)).isSymbolicLink())throw new Error('storage.directoryChanged');if(p===path.dirname(p))return}}
async function present(target:string):Promise<boolean>{try{await lstat(target);return true}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return false;throw error}}

/** Used only after a main-owned application-data review and explicit acknowledgement. */
export async function trashApplicationDataDirectory(target:string,validate:()=>Promise<void>,language:AppLanguage,options:{trash:(target:string)=>Promise<void>;home?:string;run?:typeof command;uid?:number}):Promise<void>{
  try{await options.trash(target);if(!await present(target))return}catch{/* Revalidate the complete tree before any fallback. */}
  if(!await present(target))return
  await validate()
  const home=options.home||os.homedir(),uid=options.uid??process.getuid!(),run=options.run||command
  const trash=path.join(home,'.Trash');await mkdir(trash,{mode:0o700}).catch(error=>{if(error.code!=='EEXIST')throw error});await nonLinkedAncestors(trash)
  const trashStat=await lstat(trash)
  if(!trashStat.isDirectory()||trashStat.uid!==uid)throw new Error('storage.applicationDataTrashUnavailable')
  const name=Array.from(path.basename(target).replace(/[\p{Cc}\p{Cf}]/gu,' ').trim()).slice(0,64).join('')
  const reserved=await mkdtemp(path.join(trash,'DiskCollie-'+name+'-')),destination=path.join(reserved,path.basename(target))
  try{
    await nonLinkedAncestors(path.dirname(target))
    const original=await lstat(target),parent=await lstat(path.dirname(target)),dest=await lstat(reserved)
    if(original.dev!==dest.dev)throw new Error('storage.applicationDataTrashUnavailable')
    const args=['-e',applicationDataMoveProgram,'digest',path.dirname(target),path.basename(target),statStamp(parent)]
    let expected:string
    try{expected=(await run('/usr/bin/perl',args,120000)).trim()}catch{throw new Error('storage.directoryIncomplete')}
    if(!/^[a-f0-9]{64}$/.test(expected))throw new Error('storage.directoryIncomplete')
    await validate()
    const move=['/usr/bin/perl','-e',applicationDataMoveProgram,'move',path.dirname(target),path.basename(target),statStamp(parent),expected,reserved,path.basename(target),statStamp(dest),String(uid)]
    const script='/usr/bin/env -i PATH=/usr/bin:/bin:/usr/sbin:/sbin LC_ALL=C '+move.map(shellQuote).join(' ')
    const prompt=translate(language,'storage.applicationDataAuthorization',{name})
    let output:string
    try{output=await run('/usr/bin/osascript',['-e',elevation,script,prompt],120000)}catch(error){
      const detail=(error as {stderr?:string}).stderr||String(error)
      if(/cancel|\(-128\)/i.test(detail))throw new Error('storage.applicationDataCancelled')
      if(/directory changed|destination changed/i.test(detail))throw new Error('storage.directoryChanged')
      throw new Error('storage.applicationDataMoveFailed')
    }
    const moved=await lstat(destination)
    if(!output.includes('DiskCollieApplicationDataMoved')||await present(target)||moved.dev!==original.dev||moved.ino!==original.ino)throw new Error('storage.directoryVerificationFailed')
  }finally{await rmdir(reserved).catch(()=>undefined)}
}
