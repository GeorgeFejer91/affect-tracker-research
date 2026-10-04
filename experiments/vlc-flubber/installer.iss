#define ProductName "VLC ExperimentRunner"
#define ProductVersion "0.1.0"

[Setup]
AppId={{49BA29F5-C306-4BEC-BB05-9CFAB9D1DA36}
AppName={#ProductName}
AppVersion={#ProductVersion}
AppPublisher=George Fejer
DefaultDirName={localappdata}\Programs\VLC_ExperimentRunner
DefaultGroupName=VLC ExperimentRunner
OutputDir=build\package\out
OutputBaseFilename=VLC_ExperimentRunner_Setup_0.1.0_x64
Compression=lzma2
SolidCompression=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
WizardStyle=modern
LicenseFile=..\..\LICENSE
UninstallDisplayName=VLC ExperimentRunner (Flubbercorder)

[Files]
Source: "build\package\stage\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{userprograms}\VLC ExperimentRunner"; Filename: "{app}\python\pythonw.exe"; Parameters: """{app}\app\app.py"""; WorkingDir: "{app}"

[Run]
Filename: "{app}\python\pythonw.exe"; Parameters: """{app}\app\app.py"""; Description: "Launch VLC ExperimentRunner"; Flags: nowait postinstall skipifsilent
