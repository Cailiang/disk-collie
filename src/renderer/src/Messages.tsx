import {CheckCircle2,CircleAlert,Info} from 'lucide-react'
import {createContext,useCallback,useContext,useState} from 'react'
import {createPortal} from 'react-dom'
import {WorkspaceDialog} from './WorkspaceDialog'
import {useI18n} from './i18n'
import {readableTaskError} from './AiTasks'
export interface AppMessage {message:string;tone?:'info'|'success'|'error';title?:string}
const Context=createContext<{show:(message:AppMessage)=>void}>({show:()=>undefined})
export const useMessages=():{show:(message:AppMessage)=>void}=>useContext(Context)
export function MessageProvider({children}:{children:React.ReactNode}):React.JSX.Element {
  const {t}=useI18n(),[messages,setMessages]=useState<AppMessage[]>([])
  const show=useCallback((input:AppMessage):void=>{
    const message=readableTaskError(input.message).trim()
    if(!message)return
    setMessages((queue)=>queue.some((item)=>item.message===message)?queue:[...queue,{...input,message}])
  },[])
  const current=messages[0],dismiss=():void=>setMessages((queue)=>queue.slice(1)),Icon=current?.tone==='error'?CircleAlert:current?.tone==='success'?CheckCircle2:Info
  return <Context.Provider value={{show}}>{children}{current&&createPortal(<WorkspaceDialog title={current.title||t(current.tone==='error'?'message.error':current.tone==='success'?'message.success':'message.info')} role="alertdialog" className={`message-backdrop tone-${current.tone||'info'}`} dismiss={dismiss}><div className="message-body"><Icon size={26}/><p>{current.message}</p></div><footer>{messages.length>1&&<span className="message-pending">{t('message.pending',{count:messages.length-1})}</span>}<button className="space-button primary" onClick={dismiss}>{t('message.dismiss')}</button></footer></WorkspaceDialog>,document.body)}</Context.Provider>
}
