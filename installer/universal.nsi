!include "LogicLib.nsh"
!include "x64.nsh"
Name "TransferLab 0.2.0"
OutFile "..\TransferLab-Setup-0.2.0.exe"
RequestExecutionLevel user
Unicode true
SilentInstall normal
ShowInstDetails show
Section "Install TransferLab"
  SetShellVarContext current
  InitPluginsDir
  SetOutPath "$PLUGINSDIR"
  File "payload\TransferLab-Setup-0.2.0-x64.exe"
  File "payload\TransferLab-Setup-0.2.0-x86.exe"
  ${If} ${RunningX64}
    DetailPrint "Windows 64 bits detectado. Iniciando instalador x64..."
    ExecWait '"$PLUGINSDIR\TransferLab-Setup-0.2.0-x64.exe"' $0
  ${Else}
    DetailPrint "Windows 32 bits detectado. Iniciando instalador x86..."
    ExecWait '"$PLUGINSDIR\TransferLab-Setup-0.2.0-x86.exe"' $0
  ${EndIf}
  SetOutPath "$TEMP"
  Delete "$PLUGINSDIR\TransferLab-Setup-0.2.0-x64.exe"
  Delete "$PLUGINSDIR\TransferLab-Setup-0.2.0-x86.exe"
  RMDir "$PLUGINSDIR"
  ${If} $0 != 0
    MessageBox MB_ICONEXCLAMATION "O instalador do TransferLab terminou com código $0."
  ${EndIf}
SectionEnd
