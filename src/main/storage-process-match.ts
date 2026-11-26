/** Match executable/application identity without treating short names as path substrings. */
export function storageProcessMatcher(values:string[]):(name:string)=>boolean {
  const names=values.map((value)=>value.toLowerCase().replaceAll('\\','/').trim()).filter(Boolean)
  return (name)=>{
    const expected=name.toLowerCase().replaceAll('\\','/').trim()
    if(!expected)return false
    return names.some((value)=>{
      if(value===expected||value.startsWith(expected+' ')||value.includes('/'+expected+'.app/'))return true
      return value.split(/\s+/).some((word)=>{
        const executable=word.replace(/^['"]|['"]$/g,'').split('/').at(-1)?.replace(/\.exe$/,'')||''
        return executable===expected||executable===expected+'-cli.js'||expected==='gradledaemon'&&/^org\.gradle\..*\.gradledaemon$/.test(executable)
      })
    })
  }
}
