; 人情账 · NSIS 自定义脚本
;
; 只做一件事：卸载时问用户要不要一起删掉账本数据。
; 默认「否」—— 用户重装后账本还在，这是更安全的默认值。

!macro customUnInstall
  ; /SD IDNO 表示静默模式下默认选「否」
  MessageBox MB_YESNO|MB_ICONEXCLAMATION \
    "是否同时删除账本数据？$\r$\n$\r$\n账本存放在：$\r$\n$APPDATA\RenqingLedger$\r$\n$\r$\n选择「否」会保留账本，以后重装可以继续用。$\r$\n选择「是」将永久删除，无法恢复。" \
    /SD IDNO IDYES rqz_delete_data IDNO rqz_keep_data

  rqz_delete_data:
    RMDir /r "$APPDATA\RenqingLedger"
    Goto rqz_uninstall_done

  rqz_keep_data:
    ; 什么都不做，保留数据
    Goto rqz_uninstall_done

  rqz_uninstall_done:
!macroend
