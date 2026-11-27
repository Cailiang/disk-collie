import mark from './assets/mascot/collie-mark.svg?raw'
import './CollieMark.css'
/** The checked-in SVG is shared by themed UI branding and the icon exporter. */
export function CollieMark({label,className=''}:{label:string;className?:string}):React.JSX.Element {
  return <span className={`collie-mark ${className}`} role="img" aria-label={label} dangerouslySetInnerHTML={{__html:mark}}/>
}
