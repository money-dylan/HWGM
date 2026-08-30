; The Hollow Ledger — one-file Windows installer.
; Compiled by `node release.js --installer` (optionally with --for/--key/--campaign first):
;   ISCC /DSrcDir=<built folder> /DOutName=<exe name> installer.iss
; Installs per-user (no admin), puts shortcuts on the Desktop and Start Menu, and opens the book.
; The player's saves live under the install folder and survive reinstalls and uninstalls.

#ifndef SrcDir
  #define SrcDir "dist\hollow-ledger-1.0.0"
#endif
#ifndef OutName
  #define OutName "The Hollow Ledger Setup"
#endif

[Setup]
AppId={{6E1F3A2B-9C4D-4B7E-8A21-0F5D7C3B9E11}
AppName=The Hollow Ledger
AppVersion=1.0.0
AppPublisher=Dylan Mooney
DefaultDirName={localappdata}\Hollow Ledger
DefaultGroupName=The Hollow Ledger
PrivilegesRequired=lowest
DisableDirPage=yes
DisableProgramGroupPage=yes
DisableReadyPage=yes
DisableWelcomePage=yes
OutputDir=dist
OutputBaseFilename={#OutName}
SetupIconFile=hollow-ledger.ico
UninstallDisplayIcon={app}\hollow-ledger.ico
Compression=lzma2
SolidCompression=yes
WizardStyle=modern

[Files]
Source: "{#SrcDir}\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion
Source: "hollow-ledger.ico"; DestDir: "{app}"

[Dirs]
Name: "{app}\saves"
Name: "{app}\exports"
Name: "{app}\charmem"
Name: "{app}\voice\tales"

[Icons]
Name: "{userdesktop}\The Hollow Ledger"; Filename: "{app}\start.bat"; WorkingDir: "{app}"; IconFilename: "{app}\hollow-ledger.ico"; Comment: "Open the book"
Name: "{group}\The Hollow Ledger"; Filename: "{app}\start.bat"; WorkingDir: "{app}"; IconFilename: "{app}\hollow-ledger.ico"

[Run]
Filename: "{app}\start.bat"; Description: "Open the book now"; Flags: postinstall nowait shellexec skipifsilent
