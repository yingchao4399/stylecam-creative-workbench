param([ValidateRange(1, 600)][int]$Seconds = 45, [switch]$ListDevices)

if ([System.Environment]::OSVersion.Platform -notin @([System.PlatformID]::Win32NT, [System.PlatformID]::Win32Windows)) { throw 'This Raw Input probe requires Windows.' }

Add-Type -ReferencedAssemblies System.Windows.Forms -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;

public sealed class EasyInputProbe : NativeWindow, IDisposable {
    const uint RIDEV_INPUTSINK = 0x00000100;
    const uint RIDEV_PAGEONLY = 0x00000020;
    const uint RID_INPUT = 0x10000003;
    const uint RIDI_DEVICENAME = 0x20000007;
    const int WM_INPUT = 0x00FF;
    const string DeviceId = "VID_303A&PID_1006";
    int eventCount;

    [StructLayout(LayoutKind.Sequential)]
    struct RAWINPUTDEVICE {
        public ushort UsagePage;
        public ushort Usage;
        public uint Flags;
        public IntPtr Target;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct RAWINPUTHEADER {
        public uint Type;
        public uint Size;
        public IntPtr Device;
        public IntPtr WParam;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct RAWINPUTDEVICELIST {
        public IntPtr Device;
        public uint Type;
    }

    [DllImport("user32.dll", SetLastError = true)]
    static extern bool RegisterRawInputDevices(RAWINPUTDEVICE[] devices, uint count, uint size);

    [DllImport("user32.dll", SetLastError = true)]
    static extern uint GetRawInputData(IntPtr rawInput, uint command, IntPtr data, ref uint size, uint headerSize);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, EntryPoint = "GetRawInputDeviceInfoW", SetLastError = true)]
    static extern uint GetRawInputDeviceInfo(IntPtr device, uint command, StringBuilder data, ref uint size);

    [DllImport("user32.dll", SetLastError = true)]
    static extern uint GetRawInputDeviceList([Out] RAWINPUTDEVICELIST[] devices, ref uint count, uint size);

    string DeviceName(IntPtr device) {
        uint length = 0;
        GetRawInputDeviceInfo(device, RIDI_DEVICENAME, null, ref length);
        if (length == 0 || length > 4096) return "";
        var name = new StringBuilder((int)length);
        if (GetRawInputDeviceInfo(device, RIDI_DEVICENAME, name, ref length) == uint.MaxValue) return "";
        return name.ToString();
    }

    public static void ListMatchingDevices() {
        uint count = 0;
        uint itemSize = (uint)Marshal.SizeOf<RAWINPUTDEVICELIST>();
        if (GetRawInputDeviceList(null, ref count, itemSize) == uint.MaxValue || count == 0) return;
        var devices = new RAWINPUTDEVICELIST[count];
        if (GetRawInputDeviceList(devices, ref count, itemSize) == uint.MaxValue) return;
        foreach (var item in devices) {
            uint length = 0;
            GetRawInputDeviceInfo(item.Device, RIDI_DEVICENAME, null, ref length);
            if (length == 0 || length > 4096) continue;
            var name = new StringBuilder((int)length);
            GetRawInputDeviceInfo(item.Device, RIDI_DEVICENAME, name, ref length);
            if (name.ToString().IndexOf(DeviceId, StringComparison.OrdinalIgnoreCase) >= 0)
                Console.WriteLine(string.Format("Raw device type={0}  {1}", item.Type, name));
        }
    }

    protected override void WndProc(ref Message message) {
        if (message.Msg == WM_INPUT) ReadInput(message.LParam);
        base.WndProc(ref message);
    }

    void ReadInput(IntPtr handle) {
        uint size = 0;
        uint headerSize = (uint)Marshal.SizeOf<RAWINPUTHEADER>();
        if (GetRawInputData(handle, RID_INPUT, IntPtr.Zero, ref size, headerSize) == uint.MaxValue || size < headerSize) return;
        IntPtr buffer = Marshal.AllocHGlobal((int)size);
        try {
            if (GetRawInputData(handle, RID_INPUT, buffer, ref size, headerSize) == uint.MaxValue) return;
            var header = Marshal.PtrToStructure<RAWINPUTHEADER>(buffer);
            string name = DeviceName(header.Device);
            if (name.IndexOf(DeviceId, StringComparison.OrdinalIgnoreCase) < 0) return;
            int offset = (int)headerSize;
            string stamp = DateTime.Now.ToString("HH:mm:ss.fff");
            string source = header.Type == 1 ? "keyboard" : header.Type == 0 ? "mouse" : "hid";
            if (header.Type == 1 && size >= headerSize + 16) {
                ushort scan = (ushort)Marshal.ReadInt16(buffer, offset);
                ushort flags = (ushort)Marshal.ReadInt16(buffer, offset + 2);
                ushort vkey = (ushort)Marshal.ReadInt16(buffer, offset + 6);
                string edge = (flags & 1) == 0 ? "down" : "up";
                Console.WriteLine(string.Format("{0}  {1}  VK=0x{2:X2}  scan=0x{3:X2}  {4}  {5}", stamp, source, vkey, scan, edge, name));
                eventCount++;
            } else if (header.Type == 0 && size >= headerSize + 8) {
                ushort buttons = (ushort)Marshal.ReadInt16(buffer, offset + 4);
                if ((buttons & 0x0C00) == 0 && (buttons & 0x003F) == 0) return;
                short wheel = Marshal.ReadInt16(buffer, offset + 6);
                Console.WriteLine(string.Format("{0}  {1}  buttons=0x{2:X4}  wheel={3}  {4}", stamp, source, buttons, wheel, name));
                eventCount++;
            } else if (header.Type == 2 && size >= headerSize + 8) {
                int reportSize = Marshal.ReadInt32(buffer, offset);
                int reportCount = Marshal.ReadInt32(buffer, offset + 4);
                int total = Math.Min(64, Math.Max(0, reportSize * reportCount));
                var bytes = new byte[total];
                if (total > 0) Marshal.Copy(IntPtr.Add(buffer, offset + 8), bytes, 0, total);
                var hex = BitConverter.ToString(bytes).Replace("-", "");
                Console.WriteLine(string.Format("{0}  {1}  reportSize={2}  count={3}  data={4}  {5}", stamp, source, reportSize, reportCount, hex, name));
                eventCount++;
            }
        } finally {
            Marshal.FreeHGlobal(buffer);
        }
    }

    public int Capture(int seconds) {
        CreateHandle(new CreateParams());
        var devices = new[] {
            new RAWINPUTDEVICE { UsagePage = 1, Usage = 6, Flags = RIDEV_INPUTSINK, Target = Handle },
            new RAWINPUTDEVICE { UsagePage = 1, Usage = 2, Flags = RIDEV_INPUTSINK, Target = Handle },
            // EasyInput firmware versions may expose the encoder as a vendor HID collection.
            // Page-only registration lets the probe observe that collection without changing
            // the normal keyboard/mouse routing used by the workbench.
            new RAWINPUTDEVICE { UsagePage = 0xFF00, Usage = 0, Flags = RIDEV_INPUTSINK | RIDEV_PAGEONLY, Target = Handle }
        };
        if (!RegisterRawInputDevices(devices, (uint)devices.Length, (uint)Marshal.SizeOf<RAWINPUTDEVICE>()))
            throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        Console.WriteLine(string.Format("Capturing EasyInput USB Raw Input for {0} seconds ({1}).", seconds, DeviceId));
        DateTime until = DateTime.UtcNow.AddSeconds(seconds);
        while (DateTime.UtcNow < until) {
            Application.DoEvents();
            Thread.Sleep(10);
        }
        Console.WriteLine(string.Format("Capture finished: {0} device events.", eventCount));
        return eventCount;
    }

    public void Dispose() { DestroyHandle(); }
}
'@

$probe = [EasyInputProbe]::new()
try {
  if ($ListDevices) { [EasyInputProbe]::ListMatchingDevices() }
  else { [void]$probe.Capture($Seconds) }
}
finally { $probe.Dispose() }
