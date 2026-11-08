; EasyTube Windows installer (NSIS, Modern UI 2) - English
; Build with: makensis -DRESDIR=<plugins folder> installer.nsi
Unicode true

!define APPNAME "EasyTube"
!define APPNAMELEN 8
!define APPEXE "EasyTube.exe"
!define APPVERSION "2.1.2"
!define APPID "com.mehdi.easytube"
!define UNKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\EasyTube"
!define SRCDIR "dist\win-unpacked"

Name "${APPNAME}"
OutFile "dist\EasyTube-Setup-${APPVERSION}.exe"
InstallDir "$LOCALAPPDATA\Programs\${APPNAME}"
InstallDirRegKey HKCU "Software\EasyTube" "InstallDir"
RequestExecutionLevel user
ManifestDPIAware true
SetCompressor /SOLID lzma
SetCompressorDictSize 32
BrandingText "${APPNAME}"
ShowInstDetails nevershow
ShowUninstDetails nevershow

!addplugindir /x86-unicode "${RESDIR}"

!include MUI2.nsh
!include LogicLib.nsh

!define MUI_ICON "build\icon.ico"
!define MUI_UNICON "build\icon.ico"
!define MUI_WELCOMEFINISHPAGE_BITMAP "build\sidebar.bmp"
!define MUI_UNWELCOMEFINISHPAGE_BITMAP "build\sidebar.bmp"
!define MUI_ABORTWARNING

; --- Install pages
!define MUI_WELCOMEPAGE_TITLE "Welcome to ${APPNAME}"
!define MUI_WELCOMEPAGE_TEXT "${APPNAME} is a free, open-source app, created with Claude Code, that gives a simple, modern interface to yt-dlp, the famous video downloader that has no interface of its own.$\r$\n$\r$\nEverything is already included, even yt-dlp and FFmpeg: there is nothing else to download.$\r$\n$\r$\nClick Next to learn more and choose where to install it."
!insertmacro MUI_PAGE_WELCOME

; "About" page: scrolling text (same mechanism as the license page, with no agreement to accept)
!define MUI_PAGE_HEADER_TEXT "About ${APPNAME}"
!define MUI_PAGE_HEADER_SUBTEXT "Who made it, why, a big thank you to yt-dlp, and the licenses."
!define MUI_LICENSEPAGE_TEXT_TOP "Scroll down to read the rest."
!define MUI_LICENSEPAGE_TEXT_BOTTOM " "
!define MUI_LICENSEPAGE_BUTTON "&Next >"
!insertmacro MUI_PAGE_LICENSE "build\apropos.rtf"

!define MUI_DIRECTORYPAGE_TEXT_TOP "Choose the installation folder. Settings and download-engine updates stay in this same folder. Your videos will go to the folder you choose inside the app."
!define MUI_PAGE_CUSTOMFUNCTION_LEAVE DirLeave
!insertmacro MUI_PAGE_DIRECTORY

!insertmacro MUI_PAGE_INSTFILES

!define MUI_FINISHPAGE_TITLE "${APPNAME} is installed"
!define MUI_FINISHPAGE_TEXT "You will find ${APPNAME} on the Desktop and in the Start menu.$\r$\n$\r$\nPaste a link, pick a quality, and you are off."
!define MUI_FINISHPAGE_RUN "$INSTDIR\${APPEXE}"
!define MUI_FINISHPAGE_RUN_TEXT "Launch ${APPNAME} now"
!insertmacro MUI_PAGE_FINISH

; --- Uninstall pages
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

VIProductVersion "${APPVERSION}.0"
VIAddVersionKey /LANG=${LANG_ENGLISH} "ProductName" "${APPNAME}"
VIAddVersionKey /LANG=${LANG_ENGLISH} "FileDescription" "${APPNAME} Installer"
VIAddVersionKey /LANG=${LANG_ENGLISH} "FileVersion" "${APPVERSION}"
VIAddVersionKey /LANG=${LANG_ENGLISH} "ProductVersion" "${APPVERSION}"
VIAddVersionKey /LANG=${LANG_ENGLISH} "CompanyName" "${APPNAME}"
VIAddVersionKey /LANG=${LANG_ENGLISH} "LegalCopyright" "Copyright (c) 2026 The EasyTube contributors. MIT License."

; The chosen folder always gets an "EasyTube" subfolder:
; uninstalling can never empty a shared folder.
Function DirLeave
  StrCpy $1 $INSTDIR 1 -1
  ${If} $1 == "\"
    StrCpy $INSTDIR $INSTDIR -1
  ${EndIf}
  StrCpy $0 $INSTDIR ${APPNAMELEN} -${APPNAMELEN}
  ${If} $0 != "${APPNAME}"
    StrCpy $INSTDIR "$INSTDIR\${APPNAME}"
  ${EndIf}
FunctionEnd

; If the app is open, politely ask the user to close it (nothing is ever killed).
Function CheckRunning
  retry:
  FindWindow $0 "Chrome_WidgetWin_1" "${APPNAME}"
  ${If} $0 != 0
    MessageBox MB_OKCANCEL|MB_ICONINFORMATION "${APPNAME} is open.$\r$\nClose it, then click OK to continue." IDOK retry
    Abort
  ${EndIf}
FunctionEnd

Function un.CheckRunning
  retry:
  FindWindow $0 "Chrome_WidgetWin_1" "${APPNAME}"
  ${If} $0 != 0
    MessageBox MB_OKCANCEL|MB_ICONINFORMATION "${APPNAME} is open.$\r$\nClose it, then click OK to continue." IDOK retry
    Abort
  ${EndIf}
FunctionEnd

Function .onInit
  Call CheckRunning
FunctionEnd

; Deletes everything inside $INSTDIR except the "data" folder (settings, history, yt-dlp updates)
; and the uninstaller. Only ever used on a folder named "EasyTube" (see DirLeave): never a shared folder.
!macro CleanProgramFiles UN
  FindFirst $0 $1 "$INSTDIR\*.*"
  ${While} $1 != ""
    ${If} $1 != "."
    ${AndIf} $1 != ".."
    ${AndIf} $1 != "data"
    ${AndIf} $1 != "Uninstall.exe"
      ${If} ${FileExists} "$INSTDIR\$1\*.*"
        RMDir /r "$INSTDIR\$1"
      ${Else}
        Delete "$INSTDIR\$1"
      ${EndIf}
    ${EndIf}
    FindNext $0 $1
  ${EndWhile}
  FindClose $0
!macroend

Function un.onInit
  Call un.CheckRunning
FunctionEnd

Section "Install"
  ; Update in place: if EasyTube is already installed here, the old program files are replaced
  ; and "data" (settings, history, the updated yt-dlp) is kept. No need to uninstall first.
  StrCpy $2 $INSTDIR ${APPNAMELEN} -${APPNAMELEN}
  ${If} ${FileExists} "$INSTDIR\${APPEXE}"
  ${AndIf} $2 == "${APPNAME}"
    !insertmacro CleanProgramFiles ""
  ${EndIf}
  SetOutPath "$INSTDIR"
  File /r "${SRCDIR}\*.*"
  WriteUninstaller "$INSTDIR\Uninstall.exe"

  CreateShortcut "$DESKTOP\${APPNAME}.lnk" "$INSTDIR\${APPEXE}" "" "$INSTDIR\${APPEXE}" 0
  CreateShortcut "$SMPROGRAMS\${APPNAME}.lnk" "$INSTDIR\${APPEXE}" "" "$INSTDIR\${APPEXE}" 0
  ; Needed so Windows notifications show up under the app's name
  WinShell::SetLnkAUMI "$DESKTOP\${APPNAME}.lnk" "${APPID}"
  WinShell::SetLnkAUMI "$SMPROGRAMS\${APPNAME}.lnk" "${APPID}"

  WriteRegStr HKCU "Software\EasyTube" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "${UNKEY}" "DisplayName" "${APPNAME}"
  WriteRegStr HKCU "${UNKEY}" "DisplayVersion" "${APPVERSION}"
  WriteRegStr HKCU "${UNKEY}" "Publisher" "${APPNAME}"
  WriteRegStr HKCU "${UNKEY}" "DisplayIcon" "$INSTDIR\${APPEXE}"
  WriteRegStr HKCU "${UNKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNKEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegDWORD HKCU "${UNKEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNKEY}" "NoRepair" 1
SectionEnd

Section "Uninstall"
  Delete "$DESKTOP\${APPNAME}.lnk"
  Delete "$SMPROGRAMS\${APPNAME}.lnk"
  ${If} $INSTDIR != ""
    ; Keep the settings and history? (silent uninstall keeps them)
    MessageBox MB_YESNO|MB_ICONQUESTION "Keep your ${APPNAME} settings and download history?$\r$\n$\r$\nYes: they are kept in the install folder (handy if you reinstall).$\r$\nNo: everything is deleted." /SD IDYES IDYES keepdata
    RMDir /r "$INSTDIR"
    Goto datadone
    keepdata:
    !insertmacro CleanProgramFiles "un."
    Delete "$INSTDIR\Uninstall.exe"
    RMDir "$INSTDIR"
    datadone:
  ${EndIf}
  DeleteRegKey HKCU "${UNKEY}"
  DeleteRegKey HKCU "Software\EasyTube"
SectionEnd
