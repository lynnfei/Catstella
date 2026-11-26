; Catstella Inno Setup 安装脚本 — 由 tools/build-installers.cjs 通过 ISCC 编译。
; 组件：core（桌宠+皮肤，必装）/ webext（Web 插件包与安装指引，可选，档位 1：复制包 + 图文指引）。
#define AppName "Catstella"
#define AppExe "StarSuite.exe"
#define AppId "{{A3F5C7E9-1B2D-4E6F-9A8B-C0D1E2F3A4B5}"

[Setup]
AppId={#AppId}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher=Catstella Community
DefaultDirName={localappdata}\Programs\Catstella\Suite
PrivilegesRequired=lowest
DisableProgramGroupPage=yes
OutputDir={#OutputDir}
OutputBaseFilename=Catstella-Setup-{#AppVersion}-x64
SetupIconFile={#StageDir}\resources\app\Antigravity-Cat-Widget\assets\app-icon.ico
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ShowLanguageDialog=no
CloseApplications=yes
CloseApplicationsFilter=*.exe,*.dll,*.pak,*.dat,*.node
RestartApplications=no
UninstallDisplayName={#AppName}
UninstallDisplayIcon={app}\{#AppExe}
; Replace logs from prerelease installers that recorded recursive deletion of {app}.
UninstallLogMode=overwrite

[Languages]
Name: "chinese"; MessagesFile: "compiler:Languages\ChineseSimplified.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Types]
Name: "full"; Description: "完整安装（桌宠 + 皮肤 + Web 插件引导）"
Name: "compact"; Description: "仅桌面端（桌宠 + 皮肤）"
Name: "custom"; Description: "自定义"

[Components]
Name: "core"; Description: "Catstella 桌宠 + Dream Skin（必装核心）"; Types: full compact custom; Flags: fixed
Name: "webext"; Description: "Web 端插件包与安装指引（Firefox / Edge / Chrome）"; Types: full custom

[Tasks]
Name: "autostart"; Description: "开机登录后自动启动Catstella"; Flags: unchecked
Name: "hostlink"; Description: "打开 Antigravity 时联动启动（后台检测）"; Flags: unchecked

[InstallDelete]
Type: files; Name: "{app}\.byok-enabled"; Check: ExistingSuite
Type: files; Name: "{app}\resources\app\shared\gateway\*.cjs"; Check: ExistingSuite
Type: dirifempty; Name: "{app}\resources\app\shared\gateway"; Check: ExistingSuite
Type: files; Name: "{app}\resources\app\Antigravity-Dream-Skin\src\domain\byok-portal-controller.cjs"; Check: ExistingSuite
Type: files; Name: "{app}\resources\app\Antigravity-Dream-Skin\src\host\byok-portal.cjs"; Check: ExistingSuite
Type: files; Name: "{app}\resources\app\Antigravity-Dream-Skin\src\main\*.cjs"; Check: ExistingSuite
Type: files; Name: "{app}\resources\app\Antigravity-Dream-Skin\src\renderer\*"; Check: ExistingSuite
Type: files; Name: "{app}\resources\app\Antigravity-Dream-Skin\package.json"; Check: ExistingSuite
Type: files; Name: "{app}\resources\app\Antigravity-Dream-Skin\README.md"; Check: ExistingSuite
Type: files; Name: "{app}\resources\app\Antigravity-Dream-Skin\assets\app-icon.ico"; Check: ExistingSuite
Type: dirifempty; Name: "{app}\resources\app\Antigravity-Dream-Skin\src\main"; Check: ExistingSuite
Type: dirifempty; Name: "{app}\resources\app\Antigravity-Dream-Skin\src\renderer"; Check: ExistingSuite
Type: files; Name: "{app}\web-extension\kimino-gemini-companion.xpi"; Check: RemoveOldWebExt
Type: files; Name: "{app}\web-extension\kimino-gemini-companion-edge-chrome.zip"; Check: RemoveOldWebExt
Type: files; Name: "{app}\web-extension\web-plugin-guide.html"; Check: RemoveOldWebExt
Type: dirifempty; Name: "{app}\web-extension"; Check: RemoveOldWebExt

[Files]
Source:"{#StageDir}\StartupSettings.exe"; DestDir:"{app}"; Flags: ignoreversion; Components: core
; GeneratedVersion.cs 与 IconSwap.exe 只在构建机上使用（版本号注入、PE 图标替换），不进安装目录。
Source:"{#StageDir}\*"; DestDir:"{app}"; Excludes:"StartupSettings.exe,GeneratedVersion.cs,IconSwap.exe"; Flags: recursesubdirs createallsubdirs ignoreversion; Components: core
Source:"{#StageDir}\.starsuite-install"; DestDir:"{app}"; Components: core; Flags: ignoreversion
Source:"{#StageDir}\web-plugin-guide.html"; DestDir:"{app}\web-extension"; Components: webext; Flags: ignoreversion
Source:"{#WebExtFiles}\kimino-gemini-companion.xpi"; DestDir:"{app}\web-extension"; Components: webext; Flags: ignoreversion
Source:"{#WebExtFiles}\kimino-gemini-companion-edge-chrome.zip"; DestDir:"{app}\web-extension"; Components: webext; Flags: ignoreversion

[Icons]
Name:"{autodesktop}\{#AppName}"; Filename:"{app}\{#AppExe}"; IconFilename:"{app}\icons\launch.ico"; Components: core
Name:"{autoprograms}\Catstella\{#AppName}\启动"; Filename:"{app}\{#AppExe}"; IconFilename:"{app}\icons\launch.ico"; Components: core
Name:"{autoprograms}\Catstella\{#AppName}\设置"; Filename:"{app}\{#AppExe}"; Parameters:"--settings"; IconFilename:"{app}\icons\settings.ico"; Components: core
Name:"{autoprograms}\Catstella\{#AppName}\卸载"; Filename:"{uninstallexe}"; IconFilename:"{app}\icons\uninstall.ico"; Components: core

[Run]
Filename:"{app}\{#AppExe}"; Description:"立即启动 Catstella"; Flags: postinstall nowait skipifsilent skipifdoesntexist; Check: CoreSelected
Filename:"{app}\web-extension\web-plugin-guide.html"; Description:"查看 Web 插件安装指引"; Flags: postinstall shellexec skipifsilent skipifdoesntexist unchecked; Check: WebExtSelected

[Code]
var
  SavedStartup, FilesStarted, HadAutoStart, HadHostLink: Boolean;
  OldAutoStart, OldHostLink: Cardinal;

function CoreSelected(): Boolean;
begin
  Result := WizardIsComponentSelected('core');
end;

function WebExtSelected(): Boolean;
begin
  Result := WizardIsComponentSelected('webext');
end;

function ExistingSuite(): Boolean;
var Marker: AnsiString;
begin
  Result := LoadStringFromFile(ExpandConstant('{app}\.starsuite-install'), Marker)
    and (Trim(String(Marker)) = 'Suite');
end;

function RemoveOldWebExt(): Boolean;
begin
  Result := ExistingSuite() and not WebExtSelected();
end;

// Disable the old watcher first. The packaged helper waits for the target installation's processes.
function PrepareToInstall(var NeedsRestart: Boolean): String;
var ResultCode: Integer; AppExe, Root, SettingsKey: String;
begin
  Result := '';
  Root := ExpandConstant('{app}');
  SettingsKey := 'Software\AntigravityStarSuite\Suite';
  if ExistingSuite() then begin
    if not SavedStartup then begin
      HadAutoStart := RegQueryDWordValue(HKEY_CURRENT_USER, SettingsKey, 'AutoStart', OldAutoStart);
      HadHostLink := RegQueryDWordValue(HKEY_CURRENT_USER, SettingsKey, 'HostLink', OldHostLink);
      SavedStartup := True;
    end;
    RegWriteDWordValue(HKEY_CURRENT_USER, SettingsKey, 'AutoStart', 0);
    RegWriteDWordValue(HKEY_CURRENT_USER, SettingsKey, 'HostLink', 0);
    AppExe := Root + '\StarSuite.exe';
    if FileExists(AppExe) then
      Exec(AppExe, '--quit', Root, SW_HIDE, ewNoWait, ResultCode);
    ExtractTemporaryFile('StartupSettings.exe');
    if not Exec(ExpandConstant('{tmp}\StartupSettings.exe'), '--prepare-upgrade "' + Root + '"',
      Root, SW_HIDE, ewWaitUntilTerminated, ResultCode) or (ResultCode <> 0) then begin
      Result := 'Catstella 的旧进程仍在运行。请从托盘退出 Catstella 后重试。';
      Exit;
    end;
  end;
end;

procedure DeinitializeSetup();
var SettingsKey: String;
begin
  if SavedStartup and not FilesStarted then begin
    SettingsKey := 'Software\AntigravityStarSuite\Suite';
    if HadAutoStart then RegWriteDWordValue(HKEY_CURRENT_USER, SettingsKey, 'AutoStart', OldAutoStart)
    else RegDeleteValue(HKEY_CURRENT_USER, SettingsKey, 'AutoStart');
    if HadHostLink then RegWriteDWordValue(HKEY_CURRENT_USER, SettingsKey, 'HostLink', OldHostLink)
    else RegDeleteValue(HKEY_CURRENT_USER, SettingsKey, 'HostLink');
  end;
end;

procedure RemoveLegacyUninstallEntry();
begin
  // 迁移清理：旧 C# 安装器留下的卸载注册项（Inno 从本版起接管卸载）
  RegDeleteKeyIncludingSubkeys(HKEY_CURRENT_USER, 'Software\Microsoft\Windows\CurrentVersion\Uninstall\AntigravityStarSuiteSuite');
end;

// 安装后：按任务勾选写入启动标志与登录项（与 StartupSettings.SetFlags 语义一致）。
procedure CurStepChanged(CurStep: TSetupStep);
var auto, link: Integer; runCmd: String;
begin
  if CurStep = ssInstall then begin
    FilesStarted := True;
    RemoveLegacyUninstallEntry();
  end;
  if CurStep = ssPostInstall then begin
    auto := 0; link := 0;
    if WizardIsTaskSelected('autostart') then auto := 1;
    if WizardIsTaskSelected('hostlink') then link := 1;
    RegWriteDWordValue(HKEY_CURRENT_USER, 'Software\AntigravityStarSuite\Suite', 'AutoStart', auto);
    RegWriteDWordValue(HKEY_CURRENT_USER, 'Software\AntigravityStarSuite\Suite', 'HostLink', link);
    RegDeleteValue(HKEY_CURRENT_USER, 'Software\AntigravityStarSuite\Suite', 'EnableBYOK');
    RegWriteStringValue(HKEY_CURRENT_USER, 'Software\AntigravityStarSuite\Suite', 'InstallPath', ExpandConstant('{app}'));
    runCmd := '"' + ExpandConstant('{app}') + '\StartupSettings.exe" --watch';
    if (auto = 1) or (link = 1) then
      RegWriteStringValue(HKEY_CURRENT_USER, 'Software\Microsoft\Windows\CurrentVersion\Run', 'AntigravityStarSuiteSuite', runCmd)
    else
      RegDeleteValue(HKEY_CURRENT_USER, 'Software\Microsoft\Windows\CurrentVersion\Run', 'AntigravityStarSuiteSuite');
  end;
end;

// Delete only the Chromium locale warning log. Preserve an existing debug.log
// if it contains any other text, and let Inno remove its own installed files.
procedure RemoveChromiumLocaleLog();
var FileName, Line: String; Lines: TArrayOfString; I, Delimiter: Integer;
begin
  FileName := ExpandConstant('{app}\debug.log');
  if not LoadStringsFromFile(FileName, Lines) or (GetArrayLength(Lines) = 0) then Exit;
  for I := 0 to GetArrayLength(Lines) - 1 do begin
    Line := Trim(Lines[I]);
    Delimiter := Pos(':WARNING:ui\base\resource\resource_bundle.cc:', Line);
    if (Copy(Line, 1, 1) <> '[') or (Delimiter = 0) or
       (Pos('] locale_file_path.empty() for locale', Line) <= Delimiter) then Exit;
  end;
  DeleteFile(FileName);
end;

// 卸载前：优雅退出运行中的套件（单实例 IPC --quit）并等待进程树退出，绝不 taskkill。
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var ResultCode: Integer; appExe: String; i: Integer;
begin
  if CurUninstallStep = usUninstall then begin
    appExe := ExpandConstant('{app}') + '\StarSuite.exe';
    if FileExists(appExe) then begin
      Exec(appExe, '--quit', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
      for i := 1 to 12 do Sleep(1000);
    end;
    RemoveChromiumLocaleLog();
  end;
  if CurUninstallStep = usPostUninstall then begin
    RegDeleteKeyIncludingSubkeys(HKEY_CURRENT_USER, 'Software\AntigravityStarSuite\Suite');
    RegDeleteValue(HKEY_CURRENT_USER, 'Software\Microsoft\Windows\CurrentVersion\Run', 'AntigravityStarSuiteSuite');
  end;
end;
