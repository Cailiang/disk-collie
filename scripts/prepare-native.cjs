const {spawnSync}=require('node:child_process')
const {Arch}=require('builder-util')
module.exports=async(context)=>{
  const arch=Arch[context.arch]
  const platform=context.electronPlatformName
  const target={darwin:{x64:'x86_64-apple-darwin',arm64:'aarch64-apple-darwin'},win32:{x64:'x86_64-pc-windows-msvc',arm64:'aarch64-pc-windows-msvc'},linux:{x64:'x86_64-unknown-linux-gnu',arm64:'aarch64-unknown-linux-gnu'}}[platform]?.[arch]
  if(!target)throw new Error(`Unsupported native target: ${platform}/${arch}`)
  const result=spawnSync(process.execPath,['scripts/build-native.mjs'],{stdio:'inherit',env:{...process.env,DISKCOLLIE_RUST_TARGET:target,DISKCOLLIE_NATIVE_ARCH:arch}})
  if(result.status!==0)throw new Error(`Native build failed for ${target}`)
}
