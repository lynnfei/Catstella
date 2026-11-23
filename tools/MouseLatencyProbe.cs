// Only records the fixture's marked events; alternating one-pixel moves restore
// the cursor displacement. Never records user input or injects clicks/keys.
using System;using System.Diagnostics;using System.Runtime.InteropServices;using System.Threading;
class MouseLatencyProbe {
 delegate IntPtr Hook(int code,IntPtr message,IntPtr data);
 [StructLayout(LayoutKind.Sequential)]struct Point{public int X,Y;}
 [StructLayout(LayoutKind.Sequential)]struct Sample{public Point P;public uint Data,Flags,Time;public UIntPtr Extra;}
 [StructLayout(LayoutKind.Sequential)]struct Mouse{public int X,Y;public uint Data,Flags,Time;public UIntPtr Extra;}
 [StructLayout(LayoutKind.Explicit)]struct Payload{[FieldOffset(0)]public Mouse M;}
 [StructLayout(LayoutKind.Sequential)]struct Input{public uint Type;public Payload Payload;}
 [StructLayout(LayoutKind.Sequential)]struct Msg{public IntPtr Window;public uint Id;public UIntPtr W;public IntPtr L;public uint Time;public Point P;public uint Private;}
 [DllImport("user32.dll")]static extern IntPtr SetWindowsHookEx(int id,Hook callback,IntPtr module,uint thread);
 [DllImport("user32.dll")]static extern bool UnhookWindowsHookEx(IntPtr hook);
 [DllImport("user32.dll")]static extern IntPtr CallNextHookEx(IntPtr hook,int code,IntPtr message,IntPtr data);
 [DllImport("user32.dll")]static extern bool PeekMessage(out Msg msg,IntPtr w,uint a,uint b,uint remove);
 [DllImport("user32.dll")]static extern uint SendInput(uint count,Input[] inputs,int size);
 static volatile bool quit;static long sent;const ulong Marker=0xCA7511A;
 static void Main(){
  Hook callback=delegate(int c,IntPtr m,IntPtr d){
   bool own=false;if(c>=0){var s=(Sample)Marshal.PtrToStructure(d,typeof(Sample));own=s.Extra.ToUInt64()==Marker;}
   IntPtr result=CallNextHookEx(IntPtr.Zero,c,m,d);
   if(own){double ms=(Stopwatch.GetTimestamp()-Interlocked.Read(ref sent))*1000.0/Stopwatch.Frequency;Console.WriteLine("{\"delayMs\":"+ms.ToString("F3",System.Globalization.CultureInfo.InvariantCulture)+"}");Console.Out.Flush();}
   return result;
  };
  IntPtr hook=SetWindowsHookEx(14,callback,IntPtr.Zero,0);if(hook==IntPtr.Zero){Console.WriteLine("hook-failed");return;}
  try{
   new Thread(delegate(){int direction=1;string line;while((line=Console.ReadLine())!=null){if(line=="quit")break;if(line=="probe"){
    var input=new Input{Type=0,Payload=new Payload{M=new Mouse{X=direction,Flags=0x2001,Extra=new UIntPtr(Marker)}}};direction=-direction;
    Interlocked.Exchange(ref sent,Stopwatch.GetTimestamp());if(SendInput(1,new[]{input},Marshal.SizeOf(typeof(Input)))!=1){Console.WriteLine("input-failed");Console.Out.Flush();}
   }}quit=true;}){IsBackground=true}.Start();
   Console.WriteLine("ready");Console.Out.Flush();while(!quit){Msg msg;while(PeekMessage(out msg,IntPtr.Zero,0,0,1)){}Thread.Sleep(1);}
  }finally{UnhookWindowsHookEx(hook);GC.KeepAlive(callback);}
 }
}
