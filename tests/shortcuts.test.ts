import {expect,it} from 'vitest'
import {validateShortcuts,shortcutDefaults} from '../src/main/services/shortcut-validation'
it('requires modifiers, rejects duplicate and system combinations',()=>{
 expect(validateShortcuts(shortcutDefaults)).toEqual(shortcutDefaults)
 for(const focusChat of ['A','Shift+A','Command+Q','Command+Space','Control+Alt+Alt+K'])expect(()=>validateShortcuts({...shortcutDefaults,focusChat})).toThrow()
 expect(()=>validateShortcuts({focusChat:'Ctrl+Alt+K',newNote:'Alt+Control+K'})).toThrow('相同')
 expect(validateShortcuts({...shortcutDefaults,focusChat:'ctrl+alt+k'}).focusChat).toBe('Control+Alt+K')
})
