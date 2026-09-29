; Instalador de Windows (Inno Setup 6). Se compila en GitHub Actions:
;   iscc /DVersion=0.1.0 packaging\instalador.iss
; Se instala por usuario (sin permisos de administrador) y NO borra los datos al desinstalar:
;   programa → %LOCALAPPDATA%\Programs\ControlAlmacen
;   datos    → %LOCALAPPDATA%\ControlAlmacen (y respaldos en OneDrive)

#ifndef Version
  #define Version "0.0.0"
#endif

[Setup]
AppId={{6F1C8E0B-2B7A-4C39-9E0D-5A3B8D1C0A91}
AppName=Control de Almacén RIG 91
AppVersion={#Version}
AppPublisher=Almacén RIG 91
DefaultDirName={localappdata}\Programs\ControlAlmacen
DefaultGroupName=Control de Almacén
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=..\dist
OutputBaseFilename=ControlAlmacen-{#Version}-instalador
SetupIconFile=icono.ico
UninstallDisplayIcon={app}\ControlAlmacen.exe
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes

[Languages]
Name: "spanish"; MessagesFile: "compiler:Languages\Spanish.isl"

[Tasks]
Name: "escritorio"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "..\dist\ControlAlmacen\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\Control de Almacén"; Filename: "{app}\ControlAlmacen.exe"
Name: "{autodesktop}\Control de Almacén"; Filename: "{app}\ControlAlmacen.exe"; Tasks: escritorio

[Run]
Filename: "{app}\ControlAlmacen.exe"; Description: "{cm:LaunchProgram,Control de Almacén}"; Flags: nowait postinstall skipifsilent
