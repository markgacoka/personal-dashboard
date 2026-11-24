import { Component } from 'react'

// A map that can't draw (no WebGL, a tile or style failure) says so in its own
// box instead of taking the whole flight page down with it.
export class MapBoundary extends Component<{ children: React.ReactNode }, { error: string | null }> {
  state = { error: null as string | null }
  static getDerivedStateFromError(e: Error) { return { error: e.message || 'The map failed to load.' } }
  render() {
    if (this.state.error) return (
      <div className="grid h-40 place-items-center rounded-xl px-6 text-center text-[13px] text-fg-3 ring-1 ring-inset ring-border print:hidden">
        <p>The chart couldn't be drawn in this browser{/WebGL/i.test(this.state.error) ? ' (it needs WebGL)' : ''}. Everything else on this page is unaffected.</p>
      </div>
    )
    return this.props.children
  }
}
