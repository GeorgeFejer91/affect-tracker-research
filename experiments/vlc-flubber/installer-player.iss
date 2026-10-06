#define ProductName "Flubber VLC Player"
#define ProductVersion "0.1.0"

[Setup]
AppId={{E71D1DC2-4A55-4B8A-86B0-43756610E3CE}
AppName={#ProductName}
AppVersion={#ProductVersion}
AppPublisher=George Fejer
DefaultDirName={localappdata}\Programs\FlubberVLCPlayer
DefaultGroupName=Flubber VLC Player
OutputDir=build\player-package\out
OutputBaseFilename=Flubber_VLC_Player_Setup_0.1.0_x64
Compression=lzma2
SolidCompression=yes
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
