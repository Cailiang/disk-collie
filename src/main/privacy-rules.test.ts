import {mkdtemp,mkdir,rm,symlink,writeFile} from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {describe,expect,it} from 'vitest'
import {discoverPrivacyRules} from './privacy-rules'
describe('registered privacy records',()=>{
  it('discovers real profiles and separates sign-in state, activity and system records',async()=>{
    const home=await mkdtemp(path.join(os.tmpdir(),'memento-privacy-rules-'))
    try{
      const root=path.join(home,'Library/Application Support/Google/Chrome')
      for(const profile of ['Default','Profile 2','Not a browser profile'])await mkdir(path.join(root,profile),{recursive:true})
      if(process.platform!=='win32')await symlink(path.join(root,'Default'),path.join(root,'Profile 3'))
      const recent=path.join(home,'Library/Application Support/com.apple.sharedfilelist/com.apple.LSSharedFileList.ApplicationRecentDocuments')
      await mkdir(recent,{recursive:true});await writeFile(path.join(recent,'com.microsoft.vscode.sfl3'),'fixture');await writeFile(path.join(recent,'unrelated.txt'),'fixture')
      const rules=await discoverPrivacyRules('darwin',home)
      const chrome=rules.filter((rule)=>rule.source?.key==='chrome')
      expect(new Set(chrome.map((rule)=>rule.profile))).toEqual(new Set(['Default','Profile 2']))
      expect(chrome.filter((rule)=>rule.privacyCategory==='browser-accounts').every((rule)=>rule.effect==='accounts'&&rule.sqlite)).toBe(true)
      expect(chrome.some((rule)=>rule.relative.endsWith('Network/Cookies'))).toBe(true)
      expect(new Set(rules.map((rule)=>rule.privacyCategory))).toEqual(new Set(['browser-activity','browser-accounts','app-activity','system-activity']))
      expect(rules.some((rule)=>/Bookmarks|Login Data|Preferences$/.test(rule.relative))).toBe(false)
      expect(rules.filter((rule)=>rule.key==='privacyAppRecent').map((rule)=>rule.relative)).toEqual([path.join(recent,'com.microsoft.vscode.sfl3')])
    }finally{await rm(home,{recursive:true,force:true})}
  })
})
