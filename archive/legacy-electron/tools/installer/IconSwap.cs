// 零依赖 PE 图标替换：把 .ico 的多尺寸图像写入目标 exe 的图标资源组（替换 Electron 默认图标）。
// 用法：IconSwap.exe <目标exe> <图标.ico>；成功输出 OK，失败返回非零退出码。
using System;
using System.IO;
using System.Runtime.InteropServices;

internal static class IconSwap {
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr BeginUpdateResource(string fileName,bool deleteExistingResources);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool UpdateResource(IntPtr handle,uint type,ushort id,ushort language,byte[] data,uint size);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool EndUpdateResource(IntPtr handle,bool discard);

 const uint RT_ICON=3,RT_GROUP_ICON=14;
 static ushort ReadU16(byte[] b,int o){return BitConverter.ToUInt16(b,o);}
 static uint ReadU32(byte[] b,int o){return BitConverter.ToUInt32(b,o);}

 static int Main(string[] args){
  if(args.Length!=2){Console.Error.WriteLine("用法：IconSwap.exe <目标exe> <图标.ico>");return 2;}
  try{
   byte[] ico=File.ReadAllBytes(args[1]);
   if(ReadU16(ico,2)!=1)throw new Exception("不是有效的 .ico 文件");
   int count=ReadU16(ico,4);
   IntPtr handle=BeginUpdateResource(args[0],false);
   if(handle==IntPtr.Zero)throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
   try{
    var group=new MemoryStream();
    group.Write(ico,0,6);
    for(int i=0;i<count;i++){
     int entry=6+i*16;
     int size=(int)ReadU32(ico,entry+8),offset=(int)ReadU32(ico,entry+12);
     byte[] image=new byte[size];Buffer.BlockCopy(ico,offset,image,0,size);
     if(!UpdateResource(handle,RT_ICON,(ushort)(i+1),0,image,(uint)size))throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
     group.WriteByte(ico[entry]==0?(byte)0:ico[entry]);   // 宽度（0 代表 256）
     group.WriteByte(ico[entry+1]==0?(byte)0:ico[entry+1]); // 高度
     group.WriteByte(ico[entry+2]);group.WriteByte(0);
     group.Write(BitConverter.GetBytes(ReadU16(ico,entry+4)==0?(ushort)1:ReadU16(ico,entry+4)),0,2); // planes
     group.Write(BitConverter.GetBytes(ReadU16(ico,entry+6)==0?(ushort)32:ReadU16(ico,entry+6)),0,2); // bitCount
     group.Write(BitConverter.GetBytes(size),0,4);
     group.Write(BitConverter.GetBytes((ushort)(i+1)),0,2);
    }
    byte[] groupData=group.ToArray();
    if(!UpdateResource(handle,RT_GROUP_ICON,1,0,groupData,(uint)groupData.Length))throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
   }finally{
    if(!EndUpdateResource(handle,false))throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
   }
   Console.WriteLine("OK "+count+" icon image(s) written");
   return 0;
  }catch(Exception error){
   Console.Error.WriteLine("IconSwap 失败："+error.Message);
   return 1;
  }
 }
}
