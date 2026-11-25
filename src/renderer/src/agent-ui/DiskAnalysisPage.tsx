import type { DiskUsageNode, DiskUsageProgress, DiskUsageScanResult } from '../../../shared/types'
import { useI18n } from '../i18n'
import { DiskUsageBrowser } from './DiskUsageBrowser'

export function DiskAnalysisPage({
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
  const { text } = useI18n()
  return (
    <section className="page content-page disk-analysis-page is-active">
      <div className="page-command-bar"><span className="page-command-summary">{text("legacy.inspect_disk_usage_by_directory_deletion_a.c14228")}</span></div>
      <DiskUsageBrowser result={result} progress={progress} busy={busy} error={error} onScan={onScan} onCancel={onCancel} onReveal={onReveal} onAskAI={onAskAI} onRequestTrash={onRequestTrash} />
    </section>
  )
}
