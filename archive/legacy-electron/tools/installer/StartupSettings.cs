using System;
using System.Collections.Generic;
using System.IO;
using System.Diagnostics;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

internal static partial class StartupSettings {
#if WIDGET
 public const string Kind="Widget", Title="星语桌宠挂件", AppExe="StarWidget.exe";
#elif SUITE
 public const string Kind="Suite", Title="Catstella", AppExe="StarSuite.exe";
#else
 public const string Kind="Skin", Title="织梦壁纸皮肤", AppExe="DreamSkin.exe";
#endif
 public static string Root=AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
 const string RunKey="Software\\Microsoft\\Windows\\CurrentVersion\\Run";
 static string SettingsKey="Software\\AntigravityStarSuite\\"+Kind;
 static readonly string RunName="AntigravityStarSuite"+Kind;
 public static string Quote(string value){return "\""+value.Replace("\"", "")+"\"";}
 public static bool Flag(string key){using(var r=Registry.CurrentUser.OpenSubKey(SettingsKey))return r!=null&&(int)r.GetValue(key,0)==1;}
 static bool CurrentInstall(){using(var r=Registry.CurrentUser.OpenSubKey(SettingsKey))return r!=null&&String.Equals((string)r.GetValue("InstallPath",""),Root,StringComparison.OrdinalIgnoreCase);}
 public static void SetFlags(bool auto,bool linked){
#if RELEASE_CORE
  SetFlags(auto,linked,false,RunKey);
#else
  SetFlags(auto,linked,Flag("EnableBYOK"));
#endif
 }
#if !RELEASE_CORE
 public static void SetFlags(bool auto,bool linked,bool byok){SetFlags(auto,linked,byok,RunKey);}
#endif
 static void SetFlags(bool auto,bool linked,bool byok,string runKey){
  using(var r=Registry.CurrentUser.CreateSubKey(SettingsKey)){
   r.SetValue("AutoStart",auto?1:0);
   r.SetValue("HostLink",linked?1:0);
#if !RELEASE_CORE
   r.SetValue("EnableBYOK",byok?1:0);
#endif
   r.SetValue("InstallPath",Root);
  }
#if !RELEASE_CORE
  if(Directory.Exists(Root)){
   string byokMarker=Path.Combine(Root,".byok-enabled");
   try{
    if(byok)File.WriteAllText(byokMarker,"1\n");
    else if(File.Exists(byokMarker))File.Delete(byokMarker);
   }catch{}
  }
#endif
  using(var r=Registry.CurrentUser.CreateSubKey(runKey)){
   if(auto||linked)r.SetValue(RunName,Quote(Path.Combine(Root,"StartupSettings.exe"))+" --watch");else r.DeleteValue(RunName,false);
  }
 }
#if !RELEASE_CORE
 public static void StartGatewayFirst(){
  if(!Flag("EnableBYOK"))return;
  string exe=Path.Combine(Root,AppExe);
  string daemon=Path.Combine(Root,"resources","app","shared","gateway","daemon.cjs");
  if(!File.Exists(exe)||!File.Exists(daemon))return;
  try{
   var psi=new ProcessStartInfo(exe,Quote(daemon)){
    UseShellExecute=false,
    CreateNoWindow=true,
    WorkingDirectory=Root,
    RedirectStandardOutput=true
   };
   psi.EnvironmentVariables["ELECTRON_RUN_AS_NODE"]="1";
   var proc=Process.Start(psi);
   if(proc!=null){
    var readTask=proc.StandardOutput.ReadLineAsync();
    readTask.Wait(150);
   }
  }catch{}
 }
 public static void StopGatewayDaemon(){
  string exe=Path.Combine(Root,AppExe);
  string daemon=Path.Combine(Root,"resources","app","shared","gateway","daemon.cjs");
  if(!File.Exists(exe)||!File.Exists(daemon))return;
  try{
   var psi=new ProcessStartInfo(exe,Quote(daemon)+" --stop"){UseShellExecute=false,CreateNoWindow=true,WorkingDirectory=Root};
   psi.EnvironmentVariables["ELECTRON_RUN_AS_NODE"]="1";
   using(var p=Process.Start(psi))if(p!=null)p.WaitForExit(2000);
  }catch{}
 }
#endif
 public static void StartApp(bool background){
  string args=(background?"--background":"")+(Kind=="Skin"&&background?" --enable":"");
#if !RELEASE_CORE
  // Highest Startup Priority: ensure BYOK gateway binds (<150ms) BEFORE UI & skin injection
  if(Flag("EnableBYOK")){StartGatewayFirst();args+=" --enable-byok";}
#endif
  var p=new ProcessStartInfo(Path.Combine(Root,AppExe),args.Trim()){UseShellExecute=false,CreateNoWindow=true,WorkingDirectory=Root};
  p.EnvironmentVariables.Remove("ELECTRON_RUN_AS_NODE");Process.Start(p);
 }
 public static bool ShouldLaunch(bool auto,bool linked,bool first,bool host,bool previous){return (auto&&first)||(linked&&host&&!previous);}
 static bool HostRunning(){var all=Process.GetProcessesByName("Antigravity");try{foreach(var p in all)try{if(p.SessionId==Process.GetCurrentProcess().SessionId)return true;}catch{}return false;}finally{foreach(var p in all)p.Dispose();}}
 static void Watch(){
  bool created;using(var mutex=new Mutex(true,"Local\\StarSuiteStartup"+Kind,out created)){
   if(!created){try{if(!mutex.WaitOne(5000))return;}catch(AbandonedMutexException){}}
   bool first=true,previous=false;
   while(File.Exists(Path.Combine(Root,".starsuite-install"))){
    if(!CurrentInstall())return;
    bool auto=Flag("AutoStart"),linked=Flag("HostLink");if(!auto&&!linked)return;
    bool host=linked&&HostRunning();if(ShouldLaunch(auto,linked,first,host,previous))try{StartApp(true);}catch{}
    if(!linked)return;first=false;previous=host;Thread.Sleep(2000);
   }
  }
 }
 public static void CreateShortcut(string file,string target,string arguments,string icon=""){
  Directory.CreateDirectory(Path.GetDirectoryName(file));Type t=Type.GetTypeFromProgID("WScript.Shell");dynamic shell=Activator.CreateInstance(t);dynamic lnk=shell.CreateShortcut(file);lnk.TargetPath=target;lnk.Arguments=arguments;lnk.WorkingDirectory=Root;lnk.IconLocation=icon.Length>0?icon+",0":Path.Combine(Root,AppExe)+",0";lnk.Save();
 }
 static string Programs {get{return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs),Kind=="Suite"?"Catstella":"Antigravity Star Suite",Title);}}
 public static void Shortcuts(bool create){
  string exe=Path.Combine(Root,AppExe),manager=Path.Combine(Root,"StartupSettings.exe");
  if(Kind=="Suite"){
   // 统一套件：开始菜单只保留 启动 / 设置 / 卸载 三项，图标分别取猫娘 默认 / 得意 / 委屈 表情。
   string icons=Path.Combine(Root,"icons");
   string launchIcon=Path.Combine(icons,"launch.ico"),settingsIcon=Path.Combine(icons,"settings.ico"),uninstallIcon=Path.Combine(icons,"uninstall.ico");
   string[] paths={Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),Title+".lnk"),Path.Combine(Programs,"启动.lnk"),Path.Combine(Programs,"设置.lnk"),Path.Combine(Programs,"卸载.lnk")};
   if(create){
    CreateShortcut(paths[0],exe,"",launchIcon);
    CreateShortcut(paths[1],exe,"",launchIcon);
    CreateShortcut(paths[2],exe,"--settings",settingsIcon);
    CreateShortcut(paths[3],manager,"--uninstall",uninstallIcon);
   }else foreach(var file in paths)if(File.Exists(file))try{dynamic shell=Activator.CreateInstance(Type.GetTypeFromProgID("WScript.Shell"));dynamic lnk=shell.CreateShortcut(file);if(String.Equals((string)lnk.TargetPath,exe,StringComparison.OrdinalIgnoreCase)||String.Equals((string)lnk.TargetPath,manager,StringComparison.OrdinalIgnoreCase))File.Delete(file);}catch{}
   return;
  }
#if !SUITE
  string[] legacyPaths={Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),Title+".lnk"),Path.Combine(Programs,Title+".lnk"),Path.Combine(Programs,"启动设置.lnk"),Path.Combine(Programs,"卸载.lnk")};
  if(create){CreateShortcut(legacyPaths[0],exe,"");CreateShortcut(legacyPaths[1],exe,"");CreateShortcut(legacyPaths[2],manager,"");CreateShortcut(legacyPaths[3],manager,"--uninstall");}
  else foreach(var file in legacyPaths)if(File.Exists(file))try{dynamic shell=Activator.CreateInstance(Type.GetTypeFromProgID("WScript.Shell"));dynamic lnk=shell.CreateShortcut(file);if(String.Equals((string)lnk.TargetPath,exe,StringComparison.OrdinalIgnoreCase)||String.Equals((string)lnk.TargetPath,manager,StringComparison.OrdinalIgnoreCase))File.Delete(file);}catch{}
#endif
 }
 public static string UninstallKey {get{return "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\AntigravityStarSuite"+Kind;}}
 static void Uninstall(){
  if(!File.Exists(Path.Combine(Root,".starsuite-install")))throw new Exception("安装标记不存在，无法卸载此目录。");
  if(MessageBox.Show("卸载"+Title+"？将保留你的角色设置和用量记录。","卸载",MessageBoxButtons.YesNo)!=DialogResult.Yes)return;
#if RELEASE_CORE
  SetFlags(false,false);
#else
  StopGatewayDaemon();
  SetFlags(false,false,false);
#endif
  Shortcuts(false);
  using(var p=Process.Start(new ProcessStartInfo(Path.Combine(Root,AppExe),"--quit"){UseShellExecute=false,CreateNoWindow=true}))p.WaitForExit(5000);
  Registry.CurrentUser.DeleteSubKeyTree(UninstallKey,false);
  string temp=Path.Combine(Path.GetTempPath(),"StarSuite-Uninstall-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(temp);
  string worker=Path.Combine(temp,"StartupSettings.exe");File.Copy(Application.ExecutablePath,worker);
  Process.Start(new ProcessStartInfo(worker,"--remove-root "+Quote(Root)){UseShellExecute=false,CreateNoWindow=true});
 }
 static void RemoveRoot(string root){
  root=Path.GetFullPath(root);string marker=Path.Combine(root,".starsuite-install");
  if(!File.Exists(marker)||File.ReadAllText(marker).Trim()!=Kind||root.Length<12||Path.GetPathRoot(root)==root||String.Equals(root,Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),StringComparison.OrdinalIgnoreCase))throw new Exception("安装目录校验失败");
  Thread.Sleep(3000);for(int i=0;i<10;i++)try{Directory.Delete(root,true);return;}catch{Thread.Sleep(1000);}
  MessageBox.Show("部分文件正在使用，请退出插件后删除："+root);
 }
 static void RunSelfTest(){
  if(!ShouldLaunch(true,false,true,false,false)||ShouldLaunch(false,true,false,true,true)||!ShouldLaunch(false,true,false,true,false)||ShouldLaunch(false,false,true,true,false))
   throw new InvalidOperationException("Host launch decision test failed");

  string id=Guid.NewGuid().ToString("N");
  string previousRoot=Root,previousSettingsKey=SettingsKey;
  string testKey="Software\\AntigravityStarSuite\\Verification-"+id;
  string testRunKey=testKey+"\\Run";
  string tempRoot=Path.Combine(Path.GetTempPath(),"StarSuite-SelfTest-"+id);
  Directory.CreateDirectory(tempRoot);
  Root=tempRoot;
  SettingsKey=testKey+"\\Settings";
  try{
   string expectedRun=Quote(Path.Combine(tempRoot,"StartupSettings.exe"))+" --watch";
   SetFlags(true,false,false,testRunKey);
   if(!Flag("AutoStart")||Flag("HostLink")||!Equals(ReadRunEntry(testRunKey),expectedRun))
    throw new InvalidOperationException("Autostart test failed");
#if !RELEASE_CORE
   string marker=Path.Combine(tempRoot,".byok-enabled");
   if(File.Exists(marker))throw new InvalidOperationException("BYOK opt-out must not write marker");
#endif
   SetFlags(false,true,true,testRunKey);
   if(Flag("AutoStart")||!Flag("HostLink")||!Equals(ReadRunEntry(testRunKey),expectedRun))
    throw new InvalidOperationException("Host link test failed");
#if !RELEASE_CORE
   if(!Flag("EnableBYOK"))throw new InvalidOperationException("BYOK opt-in flag missing");
   if(!File.Exists(marker))throw new InvalidOperationException("BYOK opt-in marker missing");

   SetFlags(false,false,true,testRunKey);
   if(ReadRunEntry(testRunKey)!=null)throw new InvalidOperationException("BYOK alone must not register Run autostart");
#endif
   SetFlags(false,false,false,testRunKey);
   if(ReadRunEntry(testRunKey)!=null)throw new InvalidOperationException("Run cleanup failed");
#if !RELEASE_CORE
   if(File.Exists(marker))throw new InvalidOperationException("BYOK marker cleanup failed");
#endif
  }finally{
   Root=previousRoot;
   SettingsKey=previousSettingsKey;
   try{Directory.Delete(tempRoot,true);}
   finally{Registry.CurrentUser.DeleteSubKeyTree(testKey,false);}
  }
 }
 static object ReadRunEntry(string runKey){
  using(var key=Registry.CurrentUser.OpenSubKey(runKey))return key==null?null:key.GetValue(RunName);
 }
 static List<Process> InstalledProcesses(string root){
  var matches=new List<Process>();
  string nativeRoot=Path.Combine(root,"resources","app","Antigravity-Cat-Widget","src","native");
  foreach(var process in Process.GetProcesses()){
   bool matched=false;
   try{
    string name=process.ProcessName;
    bool launcher=String.Equals(name,Path.GetFileNameWithoutExtension(AppExe),StringComparison.OrdinalIgnoreCase)
     ||String.Equals(name,"StartupSettings",StringComparison.OrdinalIgnoreCase)
     ||String.Equals(name,"electron",StringComparison.OrdinalIgnoreCase);
    bool foreground=String.Equals(name,"ForegroundHost",StringComparison.OrdinalIgnoreCase)
     ||name.StartsWith("ForegroundHost.",StringComparison.OrdinalIgnoreCase);
    if(!launcher&&!foreground)continue;
    var module=process.MainModule;
    if(module==null)continue;
    string file=module.FileName;
    string expected=Path.Combine(foreground?nativeRoot:root,name+".exe");
    if(!String.Equals(file,expected,StringComparison.OrdinalIgnoreCase))continue;
    matches.Add(process);
    matched=true;
   }catch(InvalidOperationException){}catch(System.ComponentModel.Win32Exception){}
   finally{if(!matched)process.Dispose();}
  }
  return matches;
 }
 static bool WaitForInstallExit(string root,int waitMs,bool terminate){
  var timer=Stopwatch.StartNew();
  do{
   var processes=InstalledProcesses(root);
   if(processes.Count==0)return true;
   foreach(var process in processes){
    using(process){
     if(terminate)try{process.Kill();}catch(InvalidOperationException){}catch(System.ComponentModel.Win32Exception){}
    }
   }
   Thread.Sleep(200);
  }while(timer.ElapsedMilliseconds<waitMs);
  return false;
 }
 static int PrepareUpgrade(string directory){
  string root=new DirectoryInfo(directory).FullName;
  string marker=Path.Combine(root,".starsuite-install");
  if(!File.Exists(marker)||File.ReadAllText(marker).Trim()!=Kind)return 2;
  return WaitForInstallExit(root,5500,false)||WaitForInstallExit(root,3500,true)?0:1;
 }
 [STAThread] public static void Main(string[] args){
  if(args.Length==2&&args[0]=="--prepare-upgrade"){
   try{Environment.ExitCode=PrepareUpgrade(args[1]);}
   catch{Environment.ExitCode=2;}
   return;
  }
  if(args.Length>0&&args[0]=="--self-test"){
   try{RunSelfTest();}
   catch(Exception e){
    using(var error=new StreamWriter(Console.OpenStandardError(),new System.Text.UTF8Encoding(false)))
     error.WriteLine("StartupSettings self-test failed: "+e);
    Environment.ExitCode=1;
   }
   return;
  }
  Application.EnableVisualStyles();try{
   if(args.Length>1&&args[0]=="--remove-root"){RemoveRoot(args[1]);return;}
   if(args.Length>0&&args[0]=="--watch"){Watch();return;}
   if(args.Length>0&&args[0]=="--uninstall"){Uninstall();return;}
   var form=new Form{Text=Title+" · 启动设置",Width=560,Height=315,StartPosition=FormStartPosition.CenterScreen,FormBorderStyle=FormBorderStyle.FixedDialog,MaximizeBox=false};
   var auto=new CheckBox{Text="开机登录后自动启动",Left=24,Top=24,Width=500,Checked=Flag("AutoStart")};
   var link=new CheckBox{Text="打开 Antigravity 时联动启动（后台检测）",Left=24,Top=60,Width=500,Checked=Flag("HostLink")};
#if RELEASE_CORE
   var note=new Label{Text="两个启动选项可以独立开启。",Left=24,Top=106,Width=505,Height=55};
#else
   var byok=new CheckBox{Text="启用第三方模型网关 (BYOK / 支持自定义 API Key 与模型代理)",Left=24,Top=96,Width=510,Checked=Flag("EnableBYOK")};
   var note=new Label{Text="可独立开关。启用 BYOK 时网关具有最高启动优先级，先于 UI 完成握手。\n未勾选时不占用任何端口、不干扰已有代理；不修改宿主安装文件。",Left=24,Top=136,Width=505,Height=55};
   form.Controls.Add(byok);
#endif
   var save=new Button{Text="保存设置",Left=380,Top=214,Width=130};
   save.Click+=(s,e)=>{
#if RELEASE_CORE
    SetFlags(auto.Checked,link.Checked);
#else
    bool wasByok=Flag("EnableBYOK");
    SetFlags(auto.Checked,link.Checked,byok.Checked);
    if(wasByok&&!byok.Checked)StopGatewayDaemon();
#endif
    if(auto.Checked||link.Checked)Process.Start(new ProcessStartInfo(Application.ExecutablePath,"--watch"){UseShellExecute=false,CreateNoWindow=true});
    MessageBox.Show("启动设置已保存。");form.Close();
   };
   form.Controls.AddRange(new Control[]{auto,link,note,save});Application.Run(form);
  }catch(Exception e){MessageBox.Show(e.Message,Title);Environment.ExitCode=1;}
 }
}
