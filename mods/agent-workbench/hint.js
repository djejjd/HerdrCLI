// 热区提示的延时状态：悬停 600ms 才显示；离开/按下/拖动立即取消。
export class HoverHint {
  constructor({ schedule, delay = 600, onChange = () => {} }) {
    this.schedule = schedule; this.delay = delay; this.onChange = onChange;
    this.shown = null; this.pending = null; this.task = null;
  }
  enter(key) {
    if (this.pending === key) return;
    this._cancelTask();
    // 换到另一行时，旧的已显示提示要立刻收起，避免跨行残留。
    if (this.shown !== null && this.shown !== key) { this.shown = null; this.onChange(); }
    this.pending = key;
    this.task = this.schedule(() => {
      this.task = null;
      if (this.pending !== key) return;
      this.shown = key;
      this.onChange();
    }, this.delay);
  }
  leave() {
    this.pending = null;
    this._cancelTask();
    if (this.shown !== null) { this.shown = null; this.onChange(); }
  }
  press() { this.leave(); }
  close() { this.pending = null; this._cancelTask(); this.shown = null; }
  _cancelTask() { try { this.task?.cancel?.(); } catch {} this.task = null; }
}
