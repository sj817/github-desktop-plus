#ifndef AppVersion
  #error AppVersion is required
#endif
#ifndef SourceMsi
  #error SourceMsi is required
#endif
#ifndef OutputDir
  #error OutputDir is required
#endif
#ifndef OutputBaseFilename
  #error OutputBaseFilename is required
#endif
#ifndef SetupIcon
  #error SetupIcon is required
#endif

[Setup]
AppId=GitHubDesktopPlus
AppName=GitHub Desktop Plus
AppVersion={#AppVersion}
AppVerName=GitHub Desktop Plus {#AppVersion}
AppPublisher=sj817
AppPublisherURL=https://github.com/sj817/github-desktop-plus
AppSupportURL=https://github.com/sj817/github-desktop-plus/issues
AppUpdatesURL=https://github.com/sj817/github-desktop-plus/releases
DefaultDirName={localappdata}\GitHubDesktopPlus
DisableDirPage=no
DisableProgramGroupPage=yes
DisableReadyPage=no
DisableWelcomePage=yes
Uninstallable=no
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
CloseApplications=no
RestartIfNeededByRun=no
OutputDir={#OutputDir}
OutputBaseFilename={#OutputBaseFilename}
SetupIconFile={#SetupIcon}
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern dynamic windows11 hidebevels includetitlebar
WizardSizePercent=110
VersionInfoCompany=sj817
VersionInfoDescription=GitHub Desktop Plus Installer
VersionInfoProductName=GitHub Desktop Plus
VersionInfoProductVersion={#AppVersion}
VersionInfoVersion={#AppVersion}
SetupLogging=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"
Name: "chinesesimplified"; MessagesFile: "compiler:Languages\ChineseSimplified.isl"

[CustomMessages]
english.InstallingPayload=Installing GitHub Desktop Plus...
english.StartMsiFailed=Could not start Windows Installer:
english.MsiFailed=Windows Installer failed with exit code
chinesesimplified.InstallingPayload=正在安装 GitHub Desktop Plus…
chinesesimplified.StartMsiFailed=无法启动 Windows Installer：
chinesesimplified.MsiFailed=Windows Installer 安装失败，退出代码：

[Files]
Source: "{#SourceMsi}"; DestName: "GitHubDesktopPlus-win-x64.msi"; Flags: dontcopy noencryption

[Icons]
Name: "{autodesktop}\GitHub Desktop Plus"; Filename: "{app}\GitHub Desktop Plus.exe"; WorkingDir: "{app}"; IconFilename: "{app}\current\gdp.exe"
Name: "{userprograms}\GitHub Desktop Plus"; Filename: "{app}\GitHub Desktop Plus.exe"; WorkingDir: "{app}"; IconFilename: "{app}\current\gdp.exe"

[Run]
Filename: "{app}\current\gdp.exe"; Description: "{cm:LaunchProgram,GitHub Desktop Plus}"; Flags: postinstall nowait skipifsilent unchecked skipifdoesntexist

[Code]
var
  MsiNeedsRestart: Boolean;

procedure StopRunningApp;
var
  ResultCode: Integer;
  Launcher: String;
begin
  Launcher := ExpandConstant('{app}\current\gdp.exe');
  if FileExists(Launcher) then
    Exec(Launcher, 'stop', ExpandConstant('{app}'), SW_HIDE,
      ewWaitUntilTerminated, ResultCode);
end;

function SameVersionInstalled: Boolean;
var
  InstalledVersion: String;
begin
  Result := GetVersionNumbersString(
    ExpandConstant('{app}\current\gdp.exe'), InstalledVersion) and
    (CompareText(InstalledVersion, '{#AppVersion}.0') = 0);
end;

procedure InstallMsiPayload;
var
  MsiPath: String;
  Params: String;
  ResultCode: Integer;
begin
  ExtractTemporaryFile('GitHubDesktopPlus-win-x64.msi');
  MsiPath := ExpandConstant('{tmp}\GitHubDesktopPlus-win-x64.msi');
  Params := '/i "' + MsiPath + '" /qn /norestart ALLUSERS=2 ' +
    'MSIINSTALLPERUSER=1 VELOPACK_INSTALLDIR="' + ExpandConstant('{app}') + '"';
  if SameVersionInstalled then
    Params := Params + ' REINSTALL=ALL REINSTALLMODE=amusv';

  WizardForm.StatusLabel.Caption := CustomMessage('InstallingPayload');
  StopRunningApp;
  if not Exec(ExpandConstant('{sys}\msiexec.exe'), Params, '', SW_HIDE,
    ewWaitUntilTerminated, ResultCode) then
    RaiseException(CustomMessage('StartMsiFailed') + ' ' + SysErrorMessage(ResultCode));

  if (ResultCode <> 0) and (ResultCode <> 1641) and (ResultCode <> 3010) then
    RaiseException(CustomMessage('MsiFailed') + ' ' + IntToStr(ResultCode));

  MsiNeedsRestart := (ResultCode = 1641) or (ResultCode = 3010);
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssInstall then
    InstallMsiPayload;
end;

function NeedRestart: Boolean;
begin
  Result := MsiNeedsRestart;
end;
