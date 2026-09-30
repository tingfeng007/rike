/**
 * 输入法（IME）与键盘事件工具。
 *
 * 背景：中文/日文等输入法在按 Enter「确认候选词」时同样会派发 keydown Enter，
 * 如果直接把它当成提交，用户会在答案还没输完时就被判错。
 * 项目历史上修过一次同类问题（见 commit 73148b7），但新模块又复现了，
 * 因此这里收敛成共享工具，避免各组件各写一份。
 */

/**
 * 判断当前按键事件是否处于输入法组词状态。
 * 多数浏览器把标记放在 nativeEvent 上；部分 Safari 版本只放在事件本身，
 * 因此两者都检查。
 */
export function isImeComposing(event) {
  return Boolean(event?.nativeEvent?.isComposing ?? event?.isComposing);
}

/**
 * 生成一个只在「真正按下回车且不在输入法组词中」时才触发的 onKeyDown 处理器。
 *
 * @param {Function} handler 触发时执行的回调
 * @param {{ multiline?: boolean }} [options]
 *   multiline 为 true 时（多行输入框）忽略 Shift+Enter，保留换行语义。
 *   单行输入框保持默认，避免改动既有提交行为。
 * @returns {(event: KeyboardEvent) => void}
 */
export function onEnterSubmit(handler, { multiline = false } = {}) {
  return (event) => {
    if (event.key !== 'Enter') return;
    if (multiline && event.shiftKey) return;
    if (isImeComposing(event)) return;
    handler(event);
  };
}
