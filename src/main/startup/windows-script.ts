/** Fixed PowerShell adapter. Native identities arrive as JSON data, never script text. */
export const windowsStartupScript=String.raw`
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$WarningPreference='SilentlyContinue'
$records=[System.Collections.Generic.List[object]]::new()
$coverage=[System.Collections.Generic.List[object]]::new()
$currentSid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
function Cov($kind,$status,$count,$message='') { [void]$coverage.Add(@{source=$kind;status=$status;count=$count;message=$message}) }
function Allowed($kind) { return !$request.pickKind -or $request.pickKind -eq $kind }
function NetworkTarget($target) {
  if($target.StartsWith('\\')){return $true}
  try{return [IO.DriveInfo]::new([IO.Path]::GetPathRoot($target)).DriveType -eq [IO.DriveType]::Network}catch{return $true}
}
function Target($text) {
  $text=[Environment]::ExpandEnvironmentVariables([string]$text).Trim()
  if($text -match '^"([^"]+)"'){$value=$Matches[1]}
  elseif($text -match '^(.+?\.(?:exe|com|bat|cmd|ps1))(?=\s|$)'){$value=$Matches[1]}
  else{$value=($text -split '\s+')[0]}
  if(!$value){return ''}
  if($value.StartsWith('\??\')){$value=$value.Substring(4)}
  if($value.StartsWith('\SystemRoot\',[StringComparison]::OrdinalIgnoreCase)){$value=$env:SystemRoot+$value.Substring(11)}
  if([IO.Path]::IsPathRooted($value)){return $value}
  try{return (Get-Command -Name $value -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source}catch{return ''}
}
function Emit($key,$name,$kind,$scope,$state,$config,$target,$native,$snapshot,$running=$null,$timing=@('login'),$access='user',$toggle=$true,$remove=$true,$description='') {
  if($request.pickKey -and $request.pickKey -ne $key){return}
  $exists=$null;$publisher='';$owner='';$icon=$null
  if($target -and [IO.Path]::IsPathRooted($target) -and !(NetworkTarget $target)){
    try{$file=Get-Item -LiteralPath $target -Force -ErrorAction Stop;$exists=$true;$icon=$target
      if(!$file.PSIsContainer){$publisher=[string]$file.VersionInfo.CompanyName;$owner=[string]$file.VersionInfo.ProductName}
    }catch{if($_.Exception -is [System.Management.Automation.ItemNotFoundException] -or $_.CategoryInfo.Category -eq 'ObjectNotFound'){$exists=$false}}
  }
  $system=$scope -eq 'system' -or ($target -and $target.StartsWith($env:SystemRoot+'\',[StringComparison]::OrdinalIgnoreCase))
  if($system){$scope='system';$access='protected';$toggle=$false;$remove=$false}
  if($state -eq 'unknown'){$toggle=$false}
  if($exists -ne $true){$toggle=$false}
  $issue=if($exists -eq $false){'startup.targetMissing'}elseif($null -eq $exists){'startup.targetUnknown'}else{$null}
  [void]$records.Add(@{key=$key;native=$native;snapshot=$snapshot;item=@{name=$name;owner=$owner;ownerId=if($target){$target.ToLowerInvariant()}else{$key};publisher=$publisher;description=$description;kind=$kind;scope=$scope;state=$state;running=$running;timing=@($timing);configuration=$config;target=$target;orphan=($exists -eq $false);issue=$issue;access=$access;canToggle=$toggle;canRemove=$remove;icon=$icon}})
}
function Approval($hive,$view,$subkey,$name) {
  $base=[Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::$hive,[Microsoft.Win32.RegistryView]::$view)
  try{$key=$base.OpenSubKey($subkey);if(!$key){return @{state='enabled';value=''}}
    try{$bytes=$key.GetValue($name,$null,[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
      if($null -eq $bytes){return @{state='enabled';value=''}}
      if($bytes -isnot [byte[]] -or $bytes.Length -lt 4){return @{state='unknown';value=[string]$bytes}}
      $state=if($bytes[0] -in @(2,6)){'enabled'}elseif($bytes[0] -in @(3,7)){'disabled'}else{'unknown'}
      return @{state=$state;value=[Convert]::ToBase64String($bytes)}
    }finally{$key.Dispose()}
  }finally{$base.Dispose()}
}
function RegistryRows {
  $before=$records.Count;$partial=$false
  foreach($hive in @('CurrentUser','LocalMachine')){foreach($view in @('Registry64','Registry32')){foreach($leaf in @('Run','RunOnce')){
    if($hive -eq 'CurrentUser' -and $view -eq 'Registry32'){continue}
    $sub='Software\Microsoft\Windows\CurrentVersion\'+$leaf
    try{
      $base=[Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::$hive,[Microsoft.Win32.RegistryView]::$view)
      try{$reg=$base.OpenSubKey($sub);if(!$reg){continue}
        try{foreach($name in $reg.GetValueNames()){
          $data=$reg.GetValue($name,$null,[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames);$valueKind=[string]$reg.GetValueKind($name)
          if($valueKind -notin @('String','ExpandString')){continue}
          $approvalSub='Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\'+$(if($view -eq 'Registry32'){'Run32'}else{'Run'})
          $approval=Approval $hive 'Registry64' $approvalSub $name
          $state=if($leaf -eq 'RunOnce'){'enabled'}else{$approval.state}
          $native=@{hive=$hive;view=$view;sub=$sub;name=$name;approvalSub=$approvalSub;data=$data;valueKind=$valueKind;leaf=$leaf}
          $snap=@{data=$data;valueKind=$valueKind;approval=$approval.value}
          Emit ('registry:'+$hive+':'+$view+':'+$leaf+':'+$name) $name 'registry' $(if($hive -eq 'CurrentUser'){'user'}else{'machine'}) $state ($hive+'\'+$sub+'\'+$name) (Target $data) $native $snap $null @('login') $(if($hive -eq 'LocalMachine'){'administrator'}else{'user'}) ($leaf -eq 'Run') $true
        }}finally{$reg.Dispose()}
      }finally{$base.Dispose()}
    }catch{$partial=$true}
  }}}
  Cov 'registry' $(if($partial){'partial'}else{'complete'}) ($records.Count-$before) $(if($partial){'startup.permission'}else{''})
}
function FolderRows {
  $before=$records.Count;$partial=$false;$wsh=New-Object -ComObject WScript.Shell
  foreach($source in @(@{path=[Environment]::GetFolderPath('Startup');scope='user';hive='CurrentUser'},@{path=[Environment]::GetFolderPath('CommonStartup');scope='machine';hive='LocalMachine'})){
    try{foreach($file in Get-ChildItem -LiteralPath $source.path -Force -File -ErrorAction Stop){
      if($file.Name -eq 'desktop.ini'){continue}
      $target=$file.FullName;$description=''
      if($file.Extension -eq '.lnk'){$shortcut=$wsh.CreateShortcut($file.FullName);$target=[Environment]::ExpandEnvironmentVariables($shortcut.TargetPath);$description=$shortcut.Description}
      $approvalSub='Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\StartupFolder';$approval=Approval $source.hive 'Registry64' $approvalSub $file.Name
      $native=@{file=$file.FullName;hive=$source.hive;approvalSub=$approvalSub;name=$file.Name}
      Emit ('folder:'+$file.FullName.ToLowerInvariant()) $file.BaseName 'folder' $source.scope $approval.state $file.FullName $target $native @{hash=(Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash;approval=$approval.value} $null @('login') $(if($source.scope -eq 'machine'){'administrator'}else{'user'}) $true $true $description
    }}catch{if(Test-Path -LiteralPath $source.path){$partial=$true}}
  }
  Cov 'folder' $(if($partial){'partial'}else{'complete'}) ($records.Count-$before) $(if($partial){'startup.permission'}else{''})
}
function TaskRows {
  $before=$records.Count;$partial=$false
  try{
    $tasks=if($request.native.taskName){@(Get-ScheduledTask -TaskName $request.native.taskName -TaskPath $request.native.taskPath -ErrorAction Stop)}else{@(Get-ScheduledTask -ErrorAction Stop)}
    foreach($task in $tasks){try{
      $triggers=@($task.Triggers|Where-Object {$_.CimClass.CimClassName -match 'BootTrigger|LogonTrigger'})
      if(!$triggers.Count){continue}
      $xml=Export-ScheduledTask -TaskName $task.TaskName -TaskPath $task.TaskPath
      $targets=@($task.Actions|ForEach-Object {Target $_.Execute}|Where-Object {$_})
      $target=if($targets.Count -eq 1){$targets[0]}else{''}
      $system=$task.TaskPath.StartsWith('\Microsoft\',[StringComparison]::OrdinalIgnoreCase)
      $access=if($task.Principal.UserId -in @($currentSid,$env:USERNAME) -and $task.Principal.RunLevel -eq 0){'user'}else{'administrator'}
      $timing=@($triggers|ForEach-Object {if($_.CimClass.CimClassName -match 'Boot'){'boot'}else{'login'}}|Select-Object -Unique)
      if(@($task.Triggers).Count -gt $triggers.Count){$timing+=@('scheduled')}
      Emit ('task:'+$task.TaskPath+$task.TaskName) $task.TaskName 'task' $(if($system){'system'}else{'machine'}) $(if($task.Settings.Enabled){'enabled'}else{'disabled'}) ($task.TaskPath+$task.TaskName) $target @{taskName=$task.TaskName;taskPath=$task.TaskPath} @{xml=$xml} ($task.State -eq 'Running') $timing $access $true $true ([string]$task.Description)
    }catch{$partial=$true}}
    Cov 'task' $(if($partial){'partial'}else{'complete'}) ($records.Count-$before) $(if($partial){'startup.permission'}else{''})
  }catch{Cov 'task' 'unavailable' 0 'startup.permission'}
}
function ServiceRows {
  $before=$records.Count;$partial=$false
  try{foreach($service in Get-CimInstance Win32_Service){try{
    if($request.native.serviceName -and $service.Name -ne $request.native.serviceName){continue}
    if($service.StartMode -notin @('Auto','Disabled')){continue}
    $reg=Get-ItemProperty -LiteralPath ('Registry::HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Services\'+$service.Name) -ErrorAction Stop
    $protected=$reg.LaunchProtected -gt 0 -or $service.Name -in @('WinDefend','WdNisSvc','SecurityHealthService','Sense','wscsvc','BFE','MpsSvc','EventLog','RpcSs','DcomLaunch','SamSs','LSM')
    $target=Target $service.PathName;$state=if($service.StartMode -eq 'Auto'){'enabled'}else{'disabled'}
    Emit ('service:'+$service.Name) $service.DisplayName 'service' $(if($protected){'system'}else{'machine'}) $state ('Services\'+$service.Name) $target @{serviceName=$service.Name} @{path=$service.PathName;start=$reg.Start;delayed=$reg.DelayedAutostart;account=$service.StartName;protected=$reg.LaunchProtected} ($service.State -eq 'Running') @('boot') $(if($protected){'protected'}else{'administrator'}) (!$protected) (!$protected -and $service.State -ne 'Running' -and $target -and !(NetworkTarget $target) -and !(Test-Path -LiteralPath $target)) ([string]$service.Description)
  }catch{$partial=$true}}
  Cov 'service' $(if($partial){'partial'}else{'complete'}) ($records.Count-$before) $(if($partial){'startup.permission'}else{''})
  }catch{Cov 'service' 'unavailable' 0 'startup.permission'}
}
function PackageRows {
  $before=$records.Count;$partial=$false
  try{foreach($package in Get-AppxPackage){try{
    $manifest=Get-AppxPackageManifest $package
    foreach($task in $manifest.SelectNodes("//*[local-name()='StartupTask']")){
      $id=[string]$task.TaskId;if(!$id){continue}
      $extension=$task.ParentNode;$executable=[string]$extension.Executable
      if(!$executable){$executable=[string]$extension.ParentNode.ParentNode.Executable}
      $target=if($executable){Join-Path $package.InstallLocation $executable}else{''}
      $statePath='Registry::HKEY_CURRENT_USER\Software\Classes\Local Settings\Software\Microsoft\Windows\CurrentVersion\AppModel\SystemAppData\'+$package.PackageFamilyName+'\'+$id
      $value=(Get-ItemProperty -LiteralPath $statePath -ErrorAction SilentlyContinue).State
      $state=if($null -eq $value){'unknown'}elseif($value -in @(2,4)){'enabled'}elseif($value -in @(0,1,3)){'disabled'}else{'unknown'}
      Emit ('package:'+$package.PackageFamilyName+':'+$id) $(if($task.DisplayName){[string]$task.DisplayName}else{$package.Name}) 'package' 'user' $state $statePath $target @{} @{state=$value} $null @('login') 'settings' $false $false
      $records[$records.Count-1].item.publisher=[string]$package.PublisherDisplayName
    }
  }catch{$partial=$true}}
  Cov 'package' $(if($partial){'partial'}else{'complete'}) ($records.Count-$before) $(if($partial){'startup.permission'}else{''})
  }catch{Cov 'package' 'unavailable' 0 'startup.permission'}
}
function AdvancedRows {
  $before=$records.Count;$partial=$false
  foreach($entry in @(@{path='Registry::HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon';names=@('Shell','Userinit')},@{path='Registry::HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Windows';names=@('AppInit_DLLs')},@{path='Registry::HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Control\Session Manager';names=@('BootExecute')})){
    try{$data=Get-ItemProperty -LiteralPath $entry.path
      foreach($name in $entry.names){$value=$data.$name;if(!$value){continue};Emit ('advanced:'+$entry.path+':'+$name) $name 'advanced' 'system' 'unknown' ($entry.path+'\'+$name) '' @{} @{value=$value} $null @('boot') 'protected' $false $false}
    }catch{$partial=$true}
  }
  Cov 'advanced' $(if($partial){'partial'}else{'complete'}) ($records.Count-$before) $(if($partial){'startup.permission'}else{''})
}
function Scan {
  if(Allowed 'registry'){RegistryRows};if(Allowed 'folder'){FolderRows};if(Allowed 'task'){TaskRows};if(Allowed 'service'){ServiceRows};if(Allowed 'package'){PackageRows};if(Allowed 'advanced'){AdvancedRows}
}
function Change($row) {
  $native=$row.native;$action=$request.action
  if($action -eq 'remove' -and !$row.item.canRemove){throw 'startup.readonly'}
  if($action -ne 'remove' -and !$row.item.canToggle){throw 'startup.readonly'}
  if($row.item.kind -eq 'registry'){
    $base=[Microsoft.Win32.RegistryKey]::OpenBaseKey(([Enum]::Parse([Microsoft.Win32.RegistryHive],$native.hive)),([Enum]::Parse([Microsoft.Win32.RegistryView],$native.view)))
    try{if($action -eq 'remove'){$key=$base.OpenSubKey($native.sub,$true);try{$key.DeleteValue($native.name,$true)}finally{$key.Dispose()};if($native.leaf -eq 'Run'){$approvedBase=[Microsoft.Win32.RegistryKey]::OpenBaseKey(([Enum]::Parse([Microsoft.Win32.RegistryHive],$native.hive)),[Microsoft.Win32.RegistryView]::Registry64);try{$approved=$approvedBase.OpenSubKey($native.approvalSub,$true);if($approved){try{$approved.DeleteValue($native.name,$false)}finally{$approved.Dispose()}}}finally{$approvedBase.Dispose()}}}
      else{$approvalBase=[Microsoft.Win32.RegistryKey]::OpenBaseKey(([Enum]::Parse([Microsoft.Win32.RegistryHive],$native.hive)),[Microsoft.Win32.RegistryView]::Registry64)
        try{$approval=$approvalBase.CreateSubKey($native.approvalSub);try{$bytes=New-Object byte[] 12;$bytes[0]=if($action -eq 'enable'){2}else{3};if($action -eq 'disable'){[BitConverter]::GetBytes([DateTime]::UtcNow.ToFileTimeUtc()).CopyTo($bytes,4)};$approval.SetValue($native.name,$bytes,[Microsoft.Win32.RegistryValueKind]::Binary)}finally{$approval.Dispose()}}finally{$approvalBase.Dispose()}
      }
    }finally{$base.Dispose()}
  }elseif($row.item.kind -eq 'folder'){
    if($action -eq 'remove'){Remove-Item -LiteralPath $native.file -Force -ErrorAction Stop;$approvedBase=[Microsoft.Win32.RegistryKey]::OpenBaseKey(([Enum]::Parse([Microsoft.Win32.RegistryHive],$native.hive)),[Microsoft.Win32.RegistryView]::Registry64);try{$approved=$approvedBase.OpenSubKey($native.approvalSub,$true);if($approved){try{$approved.DeleteValue($native.name,$false)}finally{$approved.Dispose()}}}finally{$approvedBase.Dispose()}}
    else{$base=[Microsoft.Win32.RegistryKey]::OpenBaseKey(([Enum]::Parse([Microsoft.Win32.RegistryHive],$native.hive)),[Microsoft.Win32.RegistryView]::Registry64);try{$approval=$base.CreateSubKey($native.approvalSub);try{$bytes=New-Object byte[] 12;$bytes[0]=if($action -eq 'enable'){2}else{3};if($action -eq 'disable'){[BitConverter]::GetBytes([DateTime]::UtcNow.ToFileTimeUtc()).CopyTo($bytes,4)};$approval.SetValue($native.name,$bytes,[Microsoft.Win32.RegistryValueKind]::Binary)}finally{$approval.Dispose()}}finally{$base.Dispose()}}
  }elseif($row.item.kind -eq 'task'){
    if($action -eq 'remove'){Unregister-ScheduledTask -TaskName $native.taskName -TaskPath $native.taskPath -Confirm:$false}
    elseif($action -eq 'enable'){Enable-ScheduledTask -TaskName $native.taskName -TaskPath $native.taskPath|Out-Null}
    else{Disable-ScheduledTask -TaskName $native.taskName -TaskPath $native.taskPath|Out-Null}
  }elseif($row.item.kind -eq 'service'){
    if($action -eq 'remove'){& sc.exe delete $native.serviceName|Out-Null;if($LASTEXITCODE -ne 0){throw 'startup.failed'}}
    else{
      if($action -eq 'enable'){Set-Service -Name $native.serviceName -StartupType Automatic}else{Set-Service -Name $native.serviceName -StartupType Disabled}
      if($null -ne $row.snapshot.delayed){Set-ItemProperty -LiteralPath ('Registry::HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Services\'+$native.serviceName) -Name DelayedAutostart -Value ([int]$row.snapshot.delayed) -Type DWord}
    }
  }else{throw 'startup.readonly'}
}
try{
  Scan
  if($request.mode -eq 'change'){
    $row=@($records|Where-Object {$_.key -eq $request.pickKey})
    if($row.Count -ne 1){throw 'startup.changed'}
    $actual=ConvertTo-Json -InputObject $row[0].snapshot -Compress -Depth 20
    $expected=ConvertTo-Json -InputObject $request.expected -Compress -Depth 20
    # Property order is irrelevant: compare the canonical per-field JSON values.
    foreach($key in $request.expected.PSObject.Properties.Name){if((ConvertTo-Json -InputObject $row[0].snapshot[$key] -Compress -Depth 20) -ne (ConvertTo-Json -InputObject $request.expected.$key -Compress -Depth 20)){throw 'startup.changed'}}
    Change $row[0]
    $result=@{ok=$true}
  }else{$result=@{records=@($records.ToArray());coverage=@($coverage.ToArray())}}
  $json=ConvertTo-Json -InputObject $result -Compress -Depth 24
  if($request.resultFile){[IO.File]::WriteAllText($request.resultFile,$json,[Text.UTF8Encoding]::new($false))}else{[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);[Console]::WriteLine($json)}
}catch{
  if($request.resultFile){[IO.File]::WriteAllText($request.resultFile,(ConvertTo-Json -Compress @{ok=$false;error=[string]$_}),[Text.UTF8Encoding]::new($false))}
  throw
}
`
