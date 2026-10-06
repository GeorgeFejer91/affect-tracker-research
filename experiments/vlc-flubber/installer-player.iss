#define ProductName "Flubber VLC Player"
#define ProductVersion "0.2.0"

[Setup]
AppId={{E71D1DC2-4A55-4B8A-86B0-43756610E3CE}
AppName={#ProductName}
AppVersion={#ProductVersion}
AppPublisher=George Fejer
DefaultDirName={localappdata}\Programs\FlubberVLCPlayer
DefaultGroupName=Flubber VLC Player
OutputDir=build\player-package\out
OutputBaseFilename=Flubber_VLC_Player_Setup_0.2.0_x64
Compression=zip/1
SolidCompression=no
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
WizardStyle=modern
LicenseFile=..\..\LICENSE

[Files]
Source: "build\player-package\stage\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{userprograms}\Flubber VLC Player"; Filename: "{app}\FlubberVLC.exe"; WorkingDir: "{app}"
Name: "{userdesktop}\Flubber VLC Player"; Filename: "{app}\FlubberVLC.exe"; WorkingDir: "{app}"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut for video drag-and-drop"; GroupDescription: "Additional shortcuts:"

[Run]
Filename: "{app}\FlubberVLC.exe"; Description: "Open Flubber VLC Player"; Flags: nowait postinstall skipifsilent
