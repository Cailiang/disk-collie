import {
  ChevronRight,
  File,
  Folder,
  FolderOpen,
  HardDrive,
  LoaderCircle,
  Maximize2,
  Minimize2,
  RefreshCw,
  Sparkles,
  Square,
  Trash2
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  DiskUsageNode,
  DiskUsageProgress,
  DiskUsageScanResult
} from '../../../shared/types'
import { useI18n } from '../i18n'
import { formatBytes } from './utils'

function elapsedLabel(milliseconds: number, language: 'zh-CN' | 'en-US'): string {
  const seconds = Math.max(1, Math.round(milliseconds / 1000))
  return language === 'en-US' ? `${seconds}s elapsed` : `已用 ${seconds} 秒`
}

function childLabel(node: DiskUsageNode, language: 'zh-CN' | 'en-US'): string {
  if (node.kind === 'file') return language === 'en-US' ? 'File' : '文件'
  return language === 'en-US'
    ? `${node.childCount} visible ${node.childCount === 1 ? 'item' : 'items'}`
    : `${node.childCount} 个可见项目`
}

function canTrashNode(node: DiskUsageNode): boolean {
  const segments = node.location.split('/').filter(Boolean)
  if (segments.length < 2) return false
  return !(node.kind === 'directory' && segments[0] === 'Users' && segments.length === 2)
}

interface DiskColumn {
  parent: DiskUsageNode
  nodes: DiskUsageNode[]
  selectedId: string | null
}

export function DiskUsageBrowser({
  result,
  progress,
  busy,
  error,
  onScan,
  onCancel,
  onReveal,
  onAskAI,
  onRequestTrash
}: {
  result: DiskUsageScanResult | null
  progress: DiskUsageProgress | null
  busy: boolean
  error: string | null
  onScan: () => void
  onCancel: () => void
  onReveal: (id: string) => void
  onAskAI: (node: DiskUsageNode) => void
  onRequestTrash: (node: DiskUsageNode) => void
}): React.JSX.Element {
  const { language, text } = useI18n()
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [fullscreen, setFullscreen] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ node: DiskUsageNode; x: number; y: number } | null>(null)
  const columnsRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setSelectedIds([])
  }, [result?.scanId])

  useEffect(() => {
    if (!fullscreen) return
    const close = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setFullscreen(false)
    }
    document.addEventListener('keydown', close)
    return () => document.removeEventListener('keydown', close)
  }, [fullscreen])

  useEffect(() => {
    if (!contextMenu) return
    const close = (): void => setContextMenu(null)
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [contextMenu])

  const { columns, selected } = useMemo(() => {
    if (!result) return { columns: [] as DiskColumn[], selected: null }
    const nextColumns: DiskColumn[] = []
    let parent = result.root
    let current: DiskUsageNode = result.root
    let depth = 0
    while (true) {
      const selectedId = selectedIds[depth] ?? null
      nextColumns.push({ parent, nodes: parent.children, selectedId })
      if (!selectedId) break
      const child = parent.children.find((item) => item.id === selectedId)
      if (!child) break
      current = child
      if (child.kind !== 'directory' || (!child.children.length && !child.omittedChildCount)) break
      parent = child
      depth += 1
    }
    return { columns: nextColumns, selected: current }
  }, [result, selectedIds])

  useEffect(() => {
    columnsRef.current?.scrollTo({ left: columnsRef.current.scrollWidth, behavior: 'smooth' })
  }, [columns.length])

  if (!result) {
    return (
      <div className="disk-browser-empty" role="status" aria-live="polite">
        <span className={busy ? 'disk-browser-empty-icon is-scanning' : 'disk-browser-empty-icon'}>
          {busy ? <LoaderCircle className="spinner" size={23} /> : <HardDrive size={23} />}
        </span>
        <strong>{busy ? text("legacy.scanning_macintosh_hd.354ddc") : text("legacy.disk_not_scanned_yet.7d0f26")}</strong>
        <small>{busy && progress
          ? text("legacy.items.17d7c2", { p0: progress.scannedEntries.toLocaleString(), p1: elapsedLabel(progress.elapsedMs, language) })
          : text("legacy.macintosh_hd_data_volume.af5162")}</small>
        {busy && progress && <span className="disk-current-path">{progress.currentLocation}</span>}
        {error && <p className="error-copy" role="alert">{error}</p>}
        <button type="button" className={busy ? 'secondary-button' : 'primary-button'} onClick={busy ? onCancel : onScan}>
          {busy ? <><Square size={13} />{text("legacy.stop_scan.e1b77e")}</> : <><RefreshCw size={15} />{text("legacy.start_scan.2d67c2")}</>}
        </button>
      </div>
    )
  }

  const selectedNode = selected ?? result.root
  const percentage = result.root.sizeBytes
    ? Math.min(100, Math.max(0, (selectedNode.sizeBytes / result.root.sizeBytes) * 100))
    : 0
  return (
    <div className={`disk-usage-surface ${fullscreen ? 'is-fullscreen' : ''}`}>
      <div className={`disk-scan-status ${busy ? 'is-scanning' : ''}`} role="status" aria-live="polite">
        <span className="disk-scan-status-mark">{busy ? <LoaderCircle className="spinner" size={15} /> : <HardDrive size={15} />}</span>
        <div><strong>{busy
          ? progress?.message ?? text("legacy.scanning_the_disk_asynchronously.1f77d5")
          : text("legacy.disk_scan_completed.f6bfed")}</strong><small>{busy && progress
          ? text("legacy.items.17d7c2", { p0: progress.scannedEntries.toLocaleString(), p1: elapsedLabel(progress.elapsedMs, language) })
          : text("legacy.items_inaccessible_locations_skipped.60e653", { p0: result.scannedEntries.toLocaleString(), p1: result.inaccessibleEntries.toLocaleString() })}</small></div>
        <div className="disk-scan-actions">
          <button type="button" className="icon-button" onClick={() => setFullscreen((value) => !value)} title={fullscreen ? text("legacy.exit_fullscreen.3e9a1d") : text("legacy.browse_fullscreen.5637ed")} aria-label={fullscreen ? text("legacy.exit_fullscreen.3e9a1d") : text("legacy.browse_fullscreen.5637ed")}>
            {fullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </button>
          <button type="button" className="secondary-button" onClick={busy ? onCancel : onScan}>
            {busy ? <><Square size={13} />{text("legacy.stop.ddd2f6")}</> : <><RefreshCw size={14} />{text("legacy.scan_again.bc5e14")}</>}
          </button>
        </div>
      </div>

      <div className="disk-browser-head">
        <div className="disk-selection-copy"><strong>{selectedNode.location}</strong><small>{childLabel(selectedNode, language)}</small></div>
        <div className="disk-selection-size"><strong>{formatBytes(selectedNode.sizeBytes)}</strong><small>{text("legacy.of_scanned_size.a3252c", { p0: percentage.toFixed(1) })}</small></div>
        <button type="button" className="secondary-button" onClick={() => onReveal(selectedNode.id)}><FolderOpen size={14} />{text("legacy.show_in_finder.277d34")}</button>
      </div>
      <div className="disk-capacity-track" aria-hidden="true"><span style={{ width: `${percentage}%` }} /></div>

      <div className="disk-columns" ref={columnsRef}>
        {columns.map((column, columnIndex) => (
          <div className="disk-column" key={column.parent.id}>
            <div className="disk-column-title"><span>{column.parent.name}</span><span>{formatBytes(column.parent.sizeBytes)}</span></div>
            {column.nodes.map((node) => (
              <button
                type="button"
                className={`disk-node ${column.selectedId === node.id ? 'is-selected' : ''}`}
                data-node-id={node.id}
                key={node.id}
                title={`${node.location} · ${formatBytes(node.sizeBytes)}`}
                onClick={() => setSelectedIds((current) => [
                  ...current.slice(0, columnIndex),
                  node.id
                ])}
                onContextMenu={(event) => {
                  event.preventDefault()
                  setSelectedIds((current) => [...current.slice(0, columnIndex), node.id])
                  setContextMenu({
                    node,
                    x: Math.min(event.clientX, window.innerWidth - 190),
                    y: Math.min(event.clientY, window.innerHeight - 132)
                  })
                }}
              >
                <span className="disk-node-size">{formatBytes(node.sizeBytes)}</span>
                <span className="disk-node-name">{node.kind === 'directory' ? <Folder size={13} /> : <File size={13} />}<span>{node.name}</span></span>
                {(node.children.length > 0 || node.omittedChildCount > 0) && <ChevronRight size={13} />}
              </button>
            ))}
            {column.parent.omittedChildCount > 0 && (
              <div className="disk-omitted-row"><span>{text("legacy.more_items.a970ee", { p0: column.parent.omittedChildCount })}</span><strong>{formatBytes(column.parent.omittedSizeBytes)}</strong></div>
            )}
            {!column.nodes.length && <div className="disk-column-empty">{text("legacy.no_children_above_the_display_threshold.c4a5a1")}</div>}
          </div>
        ))}
      </div>
      <div className="disk-browser-foot"><span>{text("legacy.showing_items_at_least.c19644", { p0: formatBytes(result.minimumDisplayBytes) })}</span></div>
      {contextMenu && <div className="disk-context-menu" role="menu" style={{ left: contextMenu.x, top: contextMenu.y }} onPointerDown={(event) => event.stopPropagation()}>
        <button type="button" role="menuitem" onClick={() => { onReveal(contextMenu.node.id); setContextMenu(null) }}><FolderOpen size={14} />{text("legacy.show_in_finder.277d34")}</button>
        {contextMenu.node.kind === 'directory' && <button type="button" role="menuitem" onClick={() => { onAskAI(contextMenu.node); setContextMenu(null) }}><Sparkles size={14} />{text("legacy.ask_ai.8b825f")}</button>}
        {canTrashNode(contextMenu.node) && <button type="button" role="menuitem" className="is-danger" onClick={() => { onRequestTrash(contextMenu.node); setContextMenu(null) }}><Trash2 size={14} />{text("legacy.move_to_trash.488326")}</button>}
      </div>}
    </div>
  )
}
