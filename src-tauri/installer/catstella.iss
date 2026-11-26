; Catstella Inno Setup Script — compiled by src-tauri/scripts/build-tauri-installer.cjs
#define AppName "Catstella"
#define AppExe "Catstella.exe"
#define AppId "{{B7E4D1F2-9C3A-4F8B-8D6E-2A1F9C5B4E30}"

[Setup]
AppId={#AppId}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher=Catstella Community
DefaultDirName={localappdata}\Programs\Catstella
DisableProgramGroupPage=yes
OutputDir={#OutputDir}
OutputBaseFilename=Catstella-Setup-{#AppVersion}-x64
SetupIconFile={#SetupIcon}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ShowLanguageDialog=no
PrivilegesRequired=lowest
CloseApplications=yes
CloseApplicationsFilter=Catstella.exe,catstella-tauri.exe,*.dll
RestartApplications=no
UninstallDisplayName={#AppName}
UninstallDisplayIcon={app}\{#AppExe}
UninstallLogMode=overwrite

[Languages]
Name: "chinese"; MessagesFile: "compiler:Languages\ChineseSimplified.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Types]
Name: "full"; Description: "完整安装（桌面桌宠 + 皮肤 + Web 插件引导）"
Name: "compact"; Description: "仅桌面端（桌面桌宠 + 皮肤）"
Name: "custom"; Description: "自定义"

[Components]
Name: "core"; Description: "Catstella 桌面桌宠 + Dream Skin（必装核心）"; Types: full compact custom; Flags: fixed
#if IncludeWebExt == "1"
Name: "webext"; Description: "Web 端插件包与安装指引（Firefox / Edge / Chrome）"; Types: full custom
#endif

[Tasks]
Name: "hostlink"; Description: "打开 Antigravity 时自动联动启动 Catstella（推荐）"
Name: "hostcdp"; Description: "自动配置 Antigravity 快捷方式以启用皮肤与配额监测（推荐）"
Name: "autostart"; Description: "Windows 开机登录后自动启动 Catstella"; Flags: unchecked

[Files]
Source: "{#StageDir}\{#AppExe}"; DestDir: "{app}"; Flags: ignoreversion; Components: core
Source: "{#StageDir}\LICENSE"; DestDir: "{app}"; Flags: ignoreversion; Components: core
Source: "{#StageDir}\NOTICE.md"; DestDir: "{app}"; Flags: ignoreversion skipifsourcedoesntexist; Components: core
Source: "{#StageDir}\ASSETS.md"; DestDir: "{app}"; Flags: ignoreversion skipifsourcedoesntexist; Components: core
Source: "{#StageDir}\icons\*.ico"; DestDir: "{app}\icons"; Flags: ignoreversion; Components: core
#if IncludeWebExt == "1"
Source: "{#StageDir}\web-plugin-guide.html"; DestDir: "{app}\web-extension"; Flags: ignoreversion; Components: webext
Source: "{#WebExtFiles}\kimino-gemini-companion.xpi"; DestDir: "{app}\web-extension"; Flags: ignoreversion; Components: webext
Source: "{#WebExtFiles}\kimino-gemini-companion-edge-chrome.zip"; DestDir: "{app}\web-extension"; Flags: ignoreversion; Components: webext
#endif

[Icons]
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; IconFilename: "{app}\icons\launch.ico"; Components: core
Name: "{autoprograms}\Catstella\启动 Catstella"; Filename: "{app}\{#AppExe}"; IconFilename: "{app}\icons\launch.ico"; Components: core
Name: "{autoprograms}\Catstella\设置中心"; Filename: "{app}\{#AppExe}"; Parameters: "--settings"; IconFilename: "{app}\icons\settings.ico"; Components: core
Name: "{autoprograms}\Catstella\卸载"; Filename: "{uninstallexe}"; IconFilename: "{app}\icons\uninstall.ico"; Components: core

[Run]
Filename: "{app}\{#AppExe}"; Description: "立即启动 Catstella"; Flags: postinstall nowait skipifsilent skipifdoesntexist; Check: CoreSelected
#if IncludeWebExt == "1"
Filename: "{app}\web-extension\web-plugin-guide.html"; Description: "查看 Web 插件安装指引"; Flags: postinstall shellexec skipifsilent skipifdoesntexist unchecked; Check: WebExtSelected
#endif

[Code]
function CoreSelected(): Boolean;
begin
  Result := WizardIsComponentSelected('core');
end;

#if IncludeWebExt == "1"
function WebExtSelected(): Boolean;
begin
  Result := WizardIsComponentSelected('webext');
end;
#endif

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
  AppExe, AppDir, PreviewDir, PreviewExe, LegacyDir, LegacyExe, LegacyKey: String;
begin
  Result := '';
  AppDir := ExpandConstant('{app}');
  AppExe := AppDir + '\{#AppExe}';
  if FileExists(AppExe) then begin
    Exec(AppExe, '--quit', AppDir, SW_HIDE, ewWaitUntilTerminated, ResultCode);
    Sleep(450);
  end;

  PreviewDir := ExpandConstant('{localappdata}\Programs\Catstella-Tauri');
  PreviewExe := PreviewDir + '\catstella-tauri.exe';
  if FileExists(PreviewExe) then begin
    Exec(PreviewExe, '--quit', PreviewDir, SW_HIDE, ewWaitUntilTerminated, ResultCode);
    Sleep(450);
  end;

  LegacyDir := ExpandConstant('{localappdata}\Programs\Catstella\Suite');
  LegacyExe := LegacyDir + '\StarSuite.exe';
  LegacyKey := 'Software\AntigravityStarSuite\Suite';
  if FileExists(LegacyExe) then begin
    RegWriteDWordValue(HKEY_CURRENT_USER, LegacyKey, 'AutoStart', 0);
    RegWriteDWordValue(HKEY_CURRENT_USER, LegacyKey, 'HostLink', 0);
    RegDeleteValue(HKEY_CURRENT_USER, 'Software\Microsoft\Windows\CurrentVersion\Run', 'AntigravityStarSuiteSuite');
    Exec(LegacyExe, '--quit', LegacyDir, SW_HIDE, ewWaitUntilTerminated, ResultCode);
    Sleep(450);
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  autoFlag, linkFlag, ResultCode: Integer;
  AppDir, AppExe, StartupKey, WatcherCmd: String;
begin
  if CurStep = ssPostInstall then begin
    AppDir := ExpandConstant('{app}');
    AppExe := AppDir + '\{#AppExe}';
    StartupKey := 'Software\Catstella\Startup';
    autoFlag := 0;
    linkFlag := 0;
    if WizardIsTaskSelected('autostart') then autoFlag := 1;
    if WizardIsTaskSelected('hostlink') then linkFlag := 1;

    RegWriteDWordValue(HKEY_CURRENT_USER, StartupKey, 'AutoStart', autoFlag);
    RegWriteDWordValue(HKEY_CURRENT_USER, StartupKey, 'HostLink', linkFlag);
    RegWriteStringValue(HKEY_CURRENT_USER, StartupKey, 'InstallPath', AppDir);

    if (autoFlag = 1) or (linkFlag = 1) then begin
      WatcherCmd := '"' + AppExe + '" --watch-host';
      RegWriteStringValue(HKEY_CURRENT_USER, 'Software\Microsoft\Windows\CurrentVersion\Run', 'CatstellaWatcher', WatcherCmd);
      Exec(AppExe, '--watch-host', AppDir, SW_HIDE, ewNoWait, ResultCode);
    end else begin
      RegDeleteValue(HKEY_CURRENT_USER, 'Software\Microsoft\Windows\CurrentVersion\Run', 'CatstellaWatcher');
    end;

    if WizardIsTaskSelected('hostcdp') then begin
      Exec(AppExe, '--configure-host-shortcuts', AppDir, SW_HIDE, ewWaitUntilTerminated, ResultCode);
    end;
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  ResultCode: Integer;
  AppDir, AppExe: String;
begin
  if CurUninstallStep = usUninstall then begin
    AppDir := ExpandConstant('{app}');
    AppExe := AppDir + '\{#AppExe}';
    if FileExists(AppExe) then begin
      Exec(AppExe, '--quit', AppDir, SW_HIDE, ewWaitUntilTerminated, ResultCode);
      Sleep(600);
    end;
  end;
  if CurUninstallStep = usPostUninstall then begin
    RegDeleteKeyIncludingSubkeys(HKEY_CURRENT_USER, 'Software\Catstella\Startup');
    RegDeleteValue(HKEY_CURRENT_USER, 'Software\Microsoft\Windows\CurrentVersion\Run', 'CatstellaWatcher');
  end;
end;
