const sensitiveFile=(name:string):boolean=>/^\.env(?:\.|$)/i.test(name)||/^(?:auth|credentials|secrets)\.json$/i.test(name)||/^id_(?:rsa|ed25519|ecdsa)(?:\.pub)?$/i.test(name)||/\.(?:pem|p12|pfx|mobileprovision|key)$/i.test(name)
/** Name-based review hints. Never open a file to classify its contents. */
export function directorySensitiveNames(names:readonly string[]):{sensitiveFiles:number;sensitiveExamples:string[]} {
  const sensitive=names.filter((name)=>sensitiveFile(name.split(/[/\\]/).pop()||name)).sort()
  return {sensitiveFiles:sensitive.length,sensitiveExamples:sensitive.slice(0,3)}
}
