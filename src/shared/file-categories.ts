/** Shared classification contract, also supplied to the native query engine. */
export const fileCategories = {
  video: ['mov','mp4','m4v','mkv','avi','webm','wmv','mpeg','mpg'],
  image: ['jpg','jpeg','png','gif','heic','heif','webp','tif','tiff','raw','dng','psd','svg'],
  audio: ['mp3','wav','flac','aac','m4a','ogg','aiff','wma'],
  archive: ['zip','7z','rar','gz','bz2','xz','tar','zst'],
  installer: ['dmg','iso','pkg','exe','msi','deb','rpm','appimage'],
  document: ['pdf','doc','docx','xls','xlsx','ppt','pptx','txt','md','csv','pages','numbers','key','fig','sketch'],
} as const
export type FileCategory = keyof typeof fileCategories | 'other'
export function fileCategory(name:string): FileCategory {
  const ext=name.includes('.')?name.split('.').pop()!.toLowerCase():''
  return (Object.entries(fileCategories).find(([,extensions])=>(extensions as readonly string[]).includes(ext))?.[0] as FileCategory) || 'other'
}
