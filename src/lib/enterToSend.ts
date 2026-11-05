import type { KeyboardEvent } from 'react'

type EnterKey = Pick<KeyboardEvent, 'key' | 'shiftKey' | 'altKey' | 'repeat' | 'keyCode'> & {
  nativeEvent: Pick<globalThis.KeyboardEvent, 'isComposing'>
}

/** 한글을 조합하는 중의 Enter는 글자를 확정할 뿐이다. 이때 보내면 마지막 글자가 빠지거나 두 번 보낸다. */
export function isSendKey(event: EnterKey): boolean {
  if (event.key !== 'Enter' || event.shiftKey || event.altKey || event.repeat) return false
  return !event.nativeEvent.isComposing && event.keyCode !== 229
}

/** 입력창의 onKeyDown에 붙인다. Enter는 폼을 보내고 Shift+Enter는 줄을 바꾼다. */
export function sendOnEnter(event: KeyboardEvent<HTMLTextAreaElement>) {
  if (!isSendKey(event)) return
  event.preventDefault()
  event.currentTarget.form?.requestSubmit()
}
