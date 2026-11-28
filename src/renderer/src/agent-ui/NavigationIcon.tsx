import type {AgentViewKey} from './Shell'
/** A single 24px, 1.7pt icon family drawn for the maintenance navigation. */
export function NavigationIcon({kind,size=20}:{kind:AgentViewKey;size?:number}):React.JSX.Element {
  const drawings:Record<AgentViewKey,React.ReactNode>={
    overview:<><path d="M4 17a9 9 0 1 1 16 0M5 18h14M12 5v2M5.6 8.4l1.5 1.3m9.8 0 1.5-1.3M12 15l4-4"/><circle cx="12" cy="15" r="1.4"/></>,
    health:<><path d="m15 3 3 3-8 8-3-3zM7 11l-4 7c3 3 6 4 9 3l2-7M5 15l6 4M18 12v4m-2-2h4M5 3v4M3 5h4"/></>,
    large:<><path d="M13 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10zM13 3v7h7"/><path d="M8 17h8M8 14h8" strokeWidth="2.7"/></>,
    duplicates:<><path d="M8 7V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-3"/><rect x="3" y="7" width="13" height="14" rx="2"/><path d="M7 12h5m-5 4h5"/></>,
    disk:<><path d="M11 3a9 9 0 1 0 10 10H11zM14 3v7h7a9 9 0 0 0-7-7Z"/><path d="m5 18 6-5"/></>,
    privacy:<><path d="M4 13c0-6 2-10 8-10 4 0 8 3 8 8M7 16V11a5 5 0 0 1 10 0v3c0 3-1 5-3 7M10 19c1-2 1-4 1-7a1 1 0 0 1 2 0c0 3 0 5-1 8M4 17l1 3M20 15c0 3-1 5-2 6"/></>,
    apps:<><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><path d="M14 17.5h7M17.5 14v7"/></>,
    processes:<><path d="M4 20V9h3v11M10 20V3h4v17M17 20V6h3v14M2 21h20"/><path d="M2 5h4m-2-2v4"/></>,
    startup:<><path d="M12 3v8M6.4 5.7a9 9 0 1 0 11.2 0"/><path d="m17 16 2 2 3-4"/></>,
    terminal:<><rect x="2.5" y="4" width="19" height="16" rx="2.5"/><path d="m7 9 4 3-4 3m7 1h3"/></>,
    agent:<><path d="M8 19H6l-4 3V6a3 3 0 0 1 3-3h14a3 3 0 0 1 3 3v10"/><circle cx="16" cy="17" r="5"/><path d="m14 17 1.5 1.5 2.5-3M6 8h11M6 12h4"/></>,
    history:<><path d="M4 8a9 9 0 1 1-1 6M3 3v6h6M12 7v6l4 2"/></>,
    settings:<><path d="M6 3v8m0 4v6M12 3v3m0 4v11M18 3v12m0 4v2"/><rect x="3.5" y="11" width="5" height="4" rx="1"/><rect x="9.5" y="6" width="5" height="4" rx="1"/><rect x="15.5" y="15" width="5" height="4" rx="1"/></>
  }
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" data-nav-icon={kind}>{drawings[kind]}</svg>
}
