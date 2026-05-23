// A template (vs layout) re-mounts on every navigation between public pages,
// so this fade-in replays as a smooth page transition. The keyframe is
// neutralised by the app-wide [data-animations="false"] reduced-motion rule.
export default function PublicTemplate({ children }: { children: React.ReactNode }) {
  return <div className="public-page-in">{children}</div>
}
