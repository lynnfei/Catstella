using System;
using System.Diagnostics;
using System.Threading;
using System.Runtime.InteropServices;
using System.Text;

internal static class ForegroundHost {
    [StructLayout(LayoutKind.Sequential)] private struct Rect { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] private struct Point { public int X, Y; }
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
    [DllImport("user32.dll")] private static extern bool GetClientRect(IntPtr window, out Rect rect);
    [DllImport("user32.dll")] private static extern bool ClientToScreen(IntPtr window, ref Point point);
    [DllImport("user32.dll")] private static extern bool IsWindow(IntPtr window);
    [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr window);
    [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr window,int command);
    [DllImport("user32.dll")] private static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] private static extern bool SetProcessDpiAwarenessContext(IntPtr context);

    private static void EnablePhysicalCoordinates() {
        try { if (SetProcessDpiAwarenessContext(new IntPtr(-4))) return; }
        catch (EntryPointNotFoundException) { }
        SetProcessDPIAware();
    }

    private static string Bounds(IntPtr window) {
        Rect rect; var point = new Point();
        if (!IsWindow(window) || IsIconic(window) || !GetClientRect(window, out rect) || !ClientToScreen(window, ref point)) return null;
        int width = rect.Right - rect.Left, height = rect.Bottom - rect.Top;
        if (width <= 0 || height <= 0) return null;
        return "{\"x\":" + point.X + ",\"y\":" + point.Y + ",\"width\":" + width + ",\"height\":" + height + "}";
    }
    private delegate bool EnumWindow(IntPtr window, IntPtr data);
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindow callback, IntPtr data);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll", EntryPoint="SetWindowLongPtrW", SetLastError=true)] private static extern IntPtr SetWindowLongPtr(IntPtr window, int index, IntPtr owner);
    [DllImport("user32.dll", EntryPoint="GetWindowLongPtrW")] private static extern IntPtr GetWindowLongPtr(IntPtr window,int index);
    [DllImport("user32.dll")] private static extern IntPtr GetWindow(IntPtr window, uint command);
    [DllImport("user32.dll")] private static extern IntPtr GetAncestor(IntPtr window, uint flags);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern int GetClassName(IntPtr window,StringBuilder name,int length);
    [DllImport("user32.dll")] private static extern bool SetWindowPos(IntPtr w,IntPtr after,int x,int y,int cx,int cy,uint flags);
    [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr w,out Rect rect);
    private delegate void WinEvent(IntPtr hook,uint ev,IntPtr w,int obj,int child,uint thread,uint time);
    [DllImport("user32.dll")] private static extern IntPtr SetWinEventHook(uint first,uint last,IntPtr module,WinEvent callback,uint pid,uint tid,uint flags);
    [DllImport("user32.dll")] private static extern bool UnhookWinEvent(IntPtr hook);
    [StructLayout(LayoutKind.Sequential)] private struct Message {public IntPtr Window;public uint Id;public UIntPtr WParam;public IntPtr LParam;public uint Time;public Point Point;public uint Private;}
    [DllImport("user32.dll")] private static extern bool PeekMessage(out Message msg,IntPtr w,uint first,uint last,uint remove);
    [DllImport("user32.dll",SetLastError=true)] private static extern uint MsgWaitForMultipleObjectsEx(uint count,IntPtr[] handles,uint milliseconds,uint wakeMask,uint flags);
    private static volatile bool stopping;
    private static bool IsHost(IntPtr window) {
        try {
            if(!IsWindow(window)||GetWindow(window,4)!=IntPtr.Zero)return false;
            var name=new StringBuilder(128);GetClassName(window,name,name.Capacity);
            Rect rect;if(name.ToString()!="Chrome_WidgetWin_1"||!GetClientRect(window,out rect)||rect.Right-rect.Left<360||rect.Bottom-rect.Top<200)return false;
            uint pid;GetWindowThreadProcessId(window,out pid);
            using(var p=Process.GetProcessById((int)pid))return String.Equals(p.ProcessName,"Antigravity",StringComparison.OrdinalIgnoreCase);
        } catch {return false;}
    }
    private static IntPtr FindHost() {
        IntPtr result=IntPtr.Zero;long largest=0;
        EnumWindows(delegate(IntPtr w,IntPtr data){Rect r;if(IsWindowVisible(w)&&IsHost(w)&&GetClientRect(w,out r)){long area=(long)(r.Right-r.Left)*(r.Bottom-r.Top);if(area>largest){largest=area;result=w;}}return true;},IntPtr.Zero);
        return result;
    }
    private static string ForegroundKind(IntPtr window, uint pid, int parentId) {
        if(window==IntPtr.Zero)return "shell";
        if(pid==(uint)parentId)return "self";
        if(IsHost(GetAncestor(window,3)))return "host";
        var name=new StringBuilder(128);GetClassName(window,name,name.Capacity);
        string cls=name.ToString();
        if(cls=="Progman"||cls=="WorkerW")return "desktop";
        if(cls=="Shell_TrayWnd"||cls=="Shell_SecondaryTrayWnd"||cls=="NotifyIconOverflowWindow"||cls=="TopLevelWindowForOverflowXamlIsland")return "shell";
        try{using(var process=Process.GetProcessById((int)pid)){
            string processName=process.ProcessName.ToLowerInvariant();
            if(processName=="shellexperiencehost"||processName=="startmenuexperiencehost"||processName=="shellhost")return "shell";
            if(processName=="msedge"||processName=="chrome"||processName=="firefox"||processName=="zen"||processName=="brave"||processName=="vivaldi"||processName=="waterfox"||processName=="floorp")return "browser";
        }}catch{}
        return "other";
    }
    private static void Main(string[] args) {
        int parentId;
        if (args.Length < 1 || !Int32.TryParse(args[0], out parentId)) return;
        EnablePhysicalCoordinates();
        long widgetValue=0;if(args.Length>1)Int64.TryParse(args[1],out widgetValue);
        IntPtr widget=new IntPtr(widgetValue);
        if(widget!=IntPtr.Zero)new Thread(delegate(){try{Console.ReadLine();}catch{}stopping=true;}){IsBackground=true}.Start();
        try {
            using (var parent = Process.GetProcessById(parentId)) {
                IntPtr lastHost = IntPtr.Zero,previousForeground=IntPtr.Zero; string previous = null;
                var hostValidation=new Stopwatch();
                var parentHandles=new IntPtr[]{parent.Handle};
                IntPtr trackedHost=IntPtr.Zero;Point hostPoint=new Point();var heartbeat=Stopwatch.StartNew();var layerHeartbeat=Stopwatch.StartNew();bool hostWasAvailable=false;int restoreGeneration=0;
                Action followHost=delegate(){
                    if(widget==IntPtr.Zero||trackedHost==IntPtr.Zero||IsIconic(trackedHost))return;
                    var next=new Point();Rect widgetRect;
                    if(ClientToScreen(trackedHost,ref next)&&GetWindowRect(widget,out widgetRect)){
                        int dx=next.X-hostPoint.X,dy=next.Y-hostPoint.Y;hostPoint=next;
                        if(dx!=0||dy!=0)SetWindowPos(widget,IntPtr.Zero,widgetRect.Left+dx,widgetRect.Top+dy,0,0,0x0015);
                    }
                };
                WinEvent locationChanged=delegate(IntPtr hook,uint ev,IntPtr w,int obj,int child,uint thread,uint time){if(w==trackedHost&&obj==0)followHost();};
                IntPtr locationHook=IntPtr.Zero;
                // Focus and location notifications wake the message wait immediately;
                // stationary windows do not need a 60 Hz cross-process polling loop.
                WinEvent focusChanged=delegate(IntPtr hook,uint ev,IntPtr w,int obj,int child,uint thread,uint time){};
                IntPtr focusHook=SetWinEventHook(3,3,IntPtr.Zero,focusChanged,0,0,0);
                bool available = false;
                bool lastWantTop = false;
                string foregroundKind = "unknown";
                do {
                    Message queued;while(PeekMessage(out queued,IntPtr.Zero,0,0,1)){}
                    string kind = "unknown", bounds = null;
                    try {
                        IntPtr window = GetForegroundWindow(); uint pid;
                        GetWindowThreadProcessId(window, out pid);
                        bool foregroundChanged=window!=previousForeground;
                        if(window!=previousForeground||foregroundKind=="unknown")foregroundKind=ForegroundKind(window,pid,parentId);
                        if(foregroundChanged){
                            IntPtr foregroundHost=GetAncestor(window,3);
                            if(IsHost(foregroundHost))lastHost=foregroundHost;
                        }
                        // PID/name discovery is expensive. Revalidate at most once
                        // per second, or immediately after the tracked HWND dies.
                        if(!hostValidation.IsRunning||hostValidation.ElapsedMilliseconds>=1000||(lastHost!=IntPtr.Zero&&!IsWindow(lastHost))){
                            if(!IsHost(lastHost))lastHost=FindHost();
                            hostValidation.Restart();
                        }
                        if(widget!=IntPtr.Zero){
                            if(trackedHost!=lastHost){
                                if(locationHook!=IntPtr.Zero){UnhookWinEvent(locationHook);locationHook=IntPtr.Zero;}
                                trackedHost=lastHost;hostPoint=new Point();ClientToScreen(lastHost,ref hostPoint);restoreGeneration++;
                                if(trackedHost!=IntPtr.Zero){
                                    uint trackedPid;uint trackedThread=GetWindowThreadProcessId(trackedHost,out trackedPid);
                                    // Do not subscribe to every application's accessibility/location events.
                                    if(trackedPid!=0&&trackedThread!=0)locationHook=SetWinEventHook(0x800B,0x800B,IntPtr.Zero,locationChanged,trackedPid,trackedThread,0);
                                }
                            }
                            if(GetWindow(widget,4)!=IntPtr.Zero)SetWindowLongPtr(widget,-8,IntPtr.Zero);
                            previousForeground=window;
                            available=lastHost!=IntPtr.Zero&&IsWindowVisible(lastHost)&&!IsIconic(lastHost);
                            uint hostPid=0;if(available)GetWindowThreadProcessId(lastHost,out hostPid);
                            bool wantTop=available&&(pid==hostPid||window==widget);
                            bool isTopmost=(GetWindowLongPtr(widget,-20).ToInt64()&8)!=0;
                            // Only touch z-order when desired layer changes, actual WS_EX_TOPMOST drifted,
                            // or foreground switched to a non-host window. Never spam SetWindowPos on idle
                            // heartbeats — doing so causes DWM / Windows 11 floating taskbar z-order flicker.
                            if((foregroundKind!="shell"||!available)&&(wantTop!=lastWantTop || isTopmost!=wantTop || (foregroundChanged && !wantTop))){
                                if(wantTop){
                                    SetWindowPos(widget,new IntPtr(-1),0,0,0,0,0x0013);
                                }else{
                                    if(isTopmost)SetWindowPos(widget,new IntPtr(-2),0,0,0,0,0x0013);
                                    if(window!=IntPtr.Zero&&window!=widget){
                                        IntPtr after=window;
                                        while(after!=IntPtr.Zero&&(GetWindowLongPtr(after,-20).ToInt64()&8)!=0)after=GetWindow(after,2);
                                        SetWindowPos(widget,after==IntPtr.Zero?new IntPtr(1):after,0,0,0,0,0x0013);
                                    }
                                }
                                lastWantTop=wantTop;
                                layerHeartbeat.Restart();
                            }
                            if(available&&!hostWasAvailable){
                                hostPoint=new Point();ClientToScreen(lastHost,ref hostPoint);
                                restoreGeneration++;
                            }
                            hostWasAvailable=available;
                            if(available)followHost();
                            bounds=available?Bounds(lastHost):null;kind=bounds==null?"other":"host";

                        }else{
                            previousForeground=window;
                            bounds=Bounds(lastHost);kind=bounds==null?"other":(pid==parentId?"self":"host");
                        }
                    } catch { lastHost = IntPtr.Zero; }
                    string message = "{\"foregroundKind\":\"" + foregroundKind + "\",\"restoreGeneration\":" + restoreGeneration + ",\"kind\":\"" + kind + "\",\"bounds\":" + (bounds ?? "null") + ",\"attached\":" + ((widget!=IntPtr.Zero&&lastHost!=IntPtr.Zero)?"true":"false") + ",\"widgetVisible\":" + ((widget!=IntPtr.Zero&&IsWindowVisible(widget))?"true":"false") + ",\"hostId\":\"" + lastHost.ToInt64() + "\",\"nativeFollowing\":" + ((widget!=IntPtr.Zero)?"true":"false") + "}";
                    if (message != previous || heartbeat.ElapsedMilliseconds>=1000) { Console.WriteLine(message); Console.Out.Flush(); previous = message; heartbeat.Restart(); }
                    if(stopping)break;
                    uint waited=MsgWaitForMultipleObjectsEx(1,parentHandles,100,0x04FF,4);
                    if(waited==0)break; // Parent exited.
                    if(waited==0xFFFFFFFF)Thread.Sleep(100); // Never spin if the wait fails.
                } while (!stopping);
                if(locationHook!=IntPtr.Zero)UnhookWinEvent(locationHook);
                if(focusHook!=IntPtr.Zero)UnhookWinEvent(focusHook);
                if(widget!=IntPtr.Zero&&IsWindow(widget))SetWindowPos(widget,new IntPtr(-2),0,0,0,0,0x0013);
                GC.KeepAlive(locationChanged);
                GC.KeepAlive(focusChanged);
                if(widget!=IntPtr.Zero&&IsWindow(widget))SetWindowLongPtr(widget,-8,IntPtr.Zero);
            }
        } catch { }
    }
}
