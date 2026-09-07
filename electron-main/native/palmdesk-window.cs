using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

internal static class PalmDeskWindow
{
    [StructLayout(LayoutKind.Sequential)]
    private struct Rect { public int Left, Top, Right, Bottom; }

    [StructLayout(LayoutKind.Sequential)]
    private struct FileTime { public uint Low, High; }

    [StructLayout(LayoutKind.Sequential)]
    private struct KeyboardInput
    {
        public ushort VirtualKey, ScanCode;
        public uint Flags, Time;
        public UIntPtr ExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MouseInput
    {
        public int X, Y;
        public uint Data, Flags, Time;
        public UIntPtr ExtraInfo;
    }

    [StructLayout(LayoutKind.Explicit)]
    private struct InputData
    {
        [FieldOffset(0)] public KeyboardInput Keyboard;
        [FieldOffset(0)] public MouseInput Mouse;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct Input { public uint Type; public InputData Data; }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct OsVersion
    {
        public int Size, Major, Minor, Build, Platform;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string ServicePack;
    }

    private sealed class WindowFailure : Exception
    {
        public readonly string Code;
        public WindowFailure(string code, string message) : base(message) { Code = code; }
    }

    private sealed class ProcessIdentity
    {
        public string Bundle;
        public string Name;
    }

    public sealed class Bounds
    {
        public int x, y, width, height;
    }

    public sealed class TargetWindow
    {
        public long nativeId;
        public uint ownerPid;
        public string bundleId, appName, name;
        public bool isOnScreen;
        public Bounds bounds;
    }

    private delegate bool EnumWindowProc(IntPtr window, IntPtr parameter);

    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate int IsCaptureSupported(IntPtr factory, out byte supported);

    [DllImport("ntdll.dll")] private static extern int RtlGetVersion(ref OsVersion version);
    [DllImport("combase.dll")] private static extern int RoInitialize(uint kind);
    [DllImport("combase.dll")] private static extern void RoUninitialize();
    [DllImport("combase.dll", CharSet = CharSet.Unicode)] private static extern int WindowsCreateString(string value, int length, out IntPtr result);
    [DllImport("combase.dll")] private static extern int WindowsDeleteString(IntPtr value);
    [DllImport("combase.dll")] private static extern int RoGetActivationFactory(IntPtr name, ref Guid id, out IntPtr factory);

    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowProc callback, IntPtr parameter);
    [DllImport("user32.dll")] private static extern bool IsWindow(IntPtr window);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr window);
    [DllImport("user32.dll")] private static extern bool IsWindowEnabled(IntPtr window);
    [DllImport("user32.dll")] private static extern IntPtr GetShellWindow();
    [DllImport("user32.dll")] private static extern IntPtr GetAncestor(IntPtr window, uint flag);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr window, StringBuilder text, int size);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr window, StringBuilder text, int size);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongW")] private static extern int GetWindowLong(IntPtr window, int index);
    [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr window, out Rect rect);
    [DllImport("dwmapi.dll", EntryPoint = "DwmGetWindowAttribute")] private static extern int DwmRect(IntPtr window, int attribute, out Rect value, int size);
    [DllImport("dwmapi.dll", EntryPoint = "DwmGetWindowAttribute")] private static extern int DwmInt(IntPtr window, int attribute, out int value, int size);
    [DllImport("user32.dll")] private static extern IntPtr MonitorFromWindow(IntPtr window, uint flags);
    [DllImport("user32.dll")] private static extern int GetSystemMetrics(int index);
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] private static extern bool BringWindowToTop(IntPtr window);
    [DllImport("user32.dll")] private static extern bool ShowWindowAsync(IntPtr window, int command);
    [DllImport("user32.dll")] private static extern bool AttachThreadInput(uint from, uint to, bool attach);
    [DllImport("user32.dll")] private static extern uint SendInput(uint count, Input[] inputs, int size);
    [DllImport("user32.dll")] private static extern bool SetProcessDpiAwarenessContext(IntPtr context);
    [DllImport("shcore.dll")] private static extern int SetProcessDpiAwareness(int awareness);
    [DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();
    [DllImport("kernel32.dll")] private static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll")] private static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] private static extern bool QueryFullProcessImageName(IntPtr process, uint flags, StringBuilder name, ref int size);
    [DllImport("kernel32.dll")] private static extern bool GetProcessTimes(IntPtr process, out FileTime created, out FileTime exited, out FileTime kernel, out FileTime user);
    [DllImport("advapi32.dll")] private static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
    [DllImport("advapi32.dll")] private static extern bool GetTokenInformation(IntPtr token, int kind, IntPtr buffer, int length, out int needed);
    [DllImport("advapi32.dll")] private static extern IntPtr GetSidSubAuthorityCount(IntPtr sid);
    [DllImport("advapi32.dll")] private static extern IntPtr GetSidSubAuthority(IntPtr sid, uint index);

    private static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 1048576 };
    private static readonly uint OwnPid = (uint)Process.GetCurrentProcess().Id;

    private static bool SupportsCapture()
    {
        var version = new OsVersion { Size = Marshal.SizeOf(typeof(OsVersion)) };
        if (RtlGetVersion(ref version) != 0 || version.Major < 10 || version.Build < 18362 ||
            GetSystemMetrics(80) == 0) return false;
        int initialized = RoInitialize(1);
        if (initialized < 0) return false;
        IntPtr name = IntPtr.Zero, factory = IntPtr.Zero;
        try
        {
            string className = "Windows.Graphics.Capture.GraphicsCaptureSession";
            if (WindowsCreateString(className, className.Length, out name) < 0) return false;
            var id = new Guid("2224a540-5974-49aa-b232-0882536f4cb5");
            if (RoGetActivationFactory(name, ref id, out factory) < 0) return false;
            // IGraphicsCaptureSessionStatics follows the six IInspectable methods.
            var isSupported = (IsCaptureSupported)Marshal.GetDelegateForFunctionPointer(
                Marshal.ReadIntPtr(Marshal.ReadIntPtr(factory), 6 * IntPtr.Size), typeof(IsCaptureSupported));
            byte supported;
            return isSupported(factory, out supported) >= 0 && supported != 0;
        }
        finally
        {
            if (factory != IntPtr.Zero) Marshal.Release(factory);
            if (name != IntPtr.Zero) WindowsDeleteString(name);
            RoUninitialize();
        }
    }

    private static ProcessIdentity ReadProcess(uint pid)
    {
        IntPtr process = OpenProcess(0x1000, false, pid);
        if (process == IntPtr.Zero) return null;
        try
        {
            var image = new StringBuilder(32768);
            int size = image.Capacity;
            FileTime created, exited, kernel, user;
            if (!QueryFullProcessImageName(process, 0, image, ref size) ||
                !GetProcessTimes(process, out created, out exited, out kernel, out user)) return null;
            string executable = image.ToString();
            ulong started = ((ulong)created.High << 32) | created.Low;
            return new ProcessIdentity {
                Bundle = "win32:" + executable.ToLowerInvariant() + "#" + started.ToString("x", CultureInfo.InvariantCulture),
                Name = Path.GetFileNameWithoutExtension(executable)
            };
        }
        finally { CloseHandle(process); }
    }

    private static TargetWindow ReadWindow(IntPtr window, Dictionary<uint, ProcessIdentity> processes)
    {
        if (!IsWindow(window) || !IsWindowVisible(window) || window == GetShellWindow() ||
            GetAncestor(window, 2) != window) return null;
        int style = GetWindowLong(window, -20);
        if ((style & 0x08000000) != 0 || ((style & 0x80) != 0 && (style & 0x40000) == 0)) return null;
        var className = new StringBuilder(256);
        GetClassName(window, className, className.Capacity);
        switch (className.ToString())
        {
            case "Progman": case "WorkerW": case "Shell_TrayWnd": case "Shell_SecondaryTrayWnd":
                return null;
        }
        int cloaked;
        if (DwmInt(window, 14, out cloaked, sizeof(int)) != 0 || cloaked != 0) return null;
        uint pid;
        GetWindowThreadProcessId(window, out pid);
        if (pid == 0 || pid == OwnPid) return null;
        ProcessIdentity identity;
        if (!processes.TryGetValue(pid, out identity))
        {
            identity = ReadProcess(pid);
            processes[pid] = identity;
        }
        if (identity == null) return null;
        Rect rect;
        bool minimized = IsIconic(window);
        // DWM's visible frame excludes invisible resize borders, matching window capture.
        if (minimized || DwmRect(window, 9, out rect, Marshal.SizeOf(typeof(Rect))) != 0)
        {
            if (!GetWindowRect(window, out rect)) return null;
        }
        if (rect.Right <= rect.Left || rect.Bottom <= rect.Top) return null;
        var title = new StringBuilder(4096);
        GetWindowText(window, title, title.Capacity);
        uint currentPid;
        GetWindowThreadProcessId(window, out currentPid);
        if (!IsWindow(window) || currentPid != pid) return null;
        return new TargetWindow {
            nativeId = window.ToInt64(), ownerPid = pid, bundleId = identity.Bundle,
            appName = identity.Name, name = title.Length > 0 ? title.ToString() : identity.Name,
            isOnScreen = !minimized && MonitorFromWindow(window, 0) != IntPtr.Zero,
            bounds = new Bounds { x = rect.Left, y = rect.Top, width = rect.Right - rect.Left, height = rect.Bottom - rect.Top }
        };
    }

    private static List<TargetWindow> ListWindows()
    {
        if (!SupportsCapture())
            throw new WindowFailure("unsupported", "Windows Graphics Capture requires Windows 10 1903 or later and an active desktop");
        var windows = new List<TargetWindow>();
        var processes = new Dictionary<uint, ProcessIdentity>();
        if (!EnumWindows(delegate(IntPtr window, IntPtr unused) {
            var entry = ReadWindow(window, processes);
            if (entry != null) windows.Add(entry);
            return true;
        }, IntPtr.Zero)) throw new WindowFailure("unavailable", "Could not enumerate desktop windows");
        return windows;
    }

    private static long Integer(Dictionary<string, object> request, string key)
    {
        object value;
        if (!request.TryGetValue(key, out value) ||
            !(value is int || value is long || value is decimal))
            throw new WindowFailure("invalid", "Invalid native window request");
        decimal number = Convert.ToDecimal(value, CultureInfo.InvariantCulture);
        if (number < 1 || number > 4294967295L || number != Decimal.Truncate(number))
            throw new WindowFailure("invalid", "Invalid native window identity");
        return (long)number;
    }

    private static TargetWindow VerifyWindow(IntPtr window, uint pid, string bundle)
    {
        var target = ReadWindow(window, new Dictionary<uint, ProcessIdentity>());
        if (target == null || target.ownerPid != pid || !String.Equals(target.bundleId, bundle, StringComparison.Ordinal))
            throw new WindowFailure("gone", "The selected window is no longer available or its identity changed");
        return target;
    }

    private static int IntegrityLevel(IntPtr process)
    {
        IntPtr token;
        if (!OpenProcessToken(process, 8, out token)) return -1;
        try
        {
            int size;
            GetTokenInformation(token, 25, IntPtr.Zero, 0, out size);
            if (size < IntPtr.Size || size > 65536) return -1;
            IntPtr buffer = Marshal.AllocHGlobal(size);
            try
            {
                if (!GetTokenInformation(token, 25, buffer, size, out size)) return -1;
                IntPtr sid = Marshal.ReadIntPtr(buffer);
                byte count = Marshal.ReadByte(GetSidSubAuthorityCount(sid));
                return count > 0 ? Marshal.ReadInt32(GetSidSubAuthority(sid, (uint)(count - 1))) : -1;
            }
            finally { Marshal.FreeHGlobal(buffer); }
        }
        finally { CloseHandle(token); }
    }

    private static void CheckInputPermission(uint pid)
    {
        IntPtr process = OpenProcess(0x1000, false, pid);
        if (process == IntPtr.Zero) throw new WindowFailure("permission", "The selected process is not accessible");
        try
        {
            int own = IntegrityLevel(GetCurrentProcess());
            int target = IntegrityLevel(process);
            if (own < 0 || target < 0 || target > own)
                throw new WindowFailure("permission", "Windows blocks input to a process with a higher privilege level");
        }
        finally { CloseHandle(process); }
    }

    private static TargetWindow FocusWindow(Dictionary<string, object> request)
    {
        var window = new IntPtr(Integer(request, "nativeId"));
        uint pid = (uint)Integer(request, "ownerPid");
        object rawBundle;
        if (!request.TryGetValue("bundleId", out rawBundle) || !(rawBundle is string))
            throw new WindowFailure("invalid", "Missing executable identity");
        string bundle = (string)rawBundle;
        if (String.IsNullOrWhiteSpace(bundle)) throw new WindowFailure("invalid", "Missing executable identity");
        VerifyWindow(window, pid, bundle);
        CheckInputPermission(pid);
        if (!IsWindowEnabled(window)) throw new WindowFailure("focus", "The selected window is blocked by a dialog");
        if (IsIconic(window))
        {
            ShowWindowAsync(window, 9);
            var restore = Stopwatch.StartNew();
            while (IsIconic(window) && restore.ElapsedMilliseconds < 1500) Thread.Sleep(25);
            VerifyWindow(window, pid, bundle);
        }
        if (GetForegroundWindow() != window)
        {
            SetForegroundWindow(window);
            if (GetForegroundWindow() != window)
            {
                uint foregroundPid;
                uint foregroundThread = GetWindowThreadProcessId(GetForegroundWindow(), out foregroundPid);
                uint ownThread = GetCurrentThreadId();
                bool attached = foregroundThread != 0 && foregroundThread != ownThread &&
                    AttachThreadInput(ownThread, foregroundThread, true);
                try
                {
                    BringWindowToTop(window);
                    SetForegroundWindow(window);
                }
                finally { if (attached) AttachThreadInput(ownThread, foregroundThread, false); }
            }
            var activation = Stopwatch.StartNew();
            while (GetForegroundWindow() != window && activation.ElapsedMilliseconds < 750) Thread.Sleep(25);
        }
        var refreshed = VerifyWindow(window, pid, bundle);
        if (!refreshed.isOnScreen || GetForegroundWindow() != window || !IsWindowEnabled(window))
            throw new WindowFailure("focus", "The selected window could not be focused; bring it to the foreground and retry");
        return refreshed;
    }

    private static object Dispatch(Dictionary<string, object> request)
    {
        object command;
        if (!request.TryGetValue("command", out command)) throw new WindowFailure("invalid", "Missing command");
        switch (command as string)
        {
            case "list": return ListWindows();
            case "focus": return FocusWindow(request);
            case "text": return TypeText(request);
            case "permissions": return new { accessibility = true, captureSupported = SupportsCapture() };
            case "thumbnails": return new object[0];
            case "diagnostics":
                var applications = new List<object>();
                var seen = new HashSet<string>();
                foreach (var window in ListWindows())
                    if (seen.Add(window.bundleId)) applications.Add(new { bundleId = window.bundleId, appName = window.appName });
                return new { applications = applications };
            default: throw new WindowFailure("invalid", "Unsupported native window command");
        }
    }

    private static object TypeText(Dictionary<string, object> request)
    {
        object value;
        if (!request.TryGetValue("text", out value) || !(value is string) ||
            ((string)value).Length < 1 || ((string)value).Length > 4096)
            throw new WindowFailure("invalid", "Text length must be between 1 and 4096");
        var target = FocusWindow(request);
        string text = (string)value;
        var inputs = new Input[text.Length * 2];
        for (int index = 0; index < text.Length; index++)
        {
            // VK_PACKET inserts literal UTF-16, bypassing keyboard-layout and IME conversion.
            inputs[index * 2] = new Input { Type = 1, Data = new InputData {
                Keyboard = new KeyboardInput { ScanCode = text[index], Flags = 4 }
            } };
            inputs[index * 2 + 1] = inputs[index * 2];
            inputs[index * 2 + 1].Data.Keyboard.Flags |= 2;
        }
        if (GetForegroundWindow().ToInt64() != target.nativeId ||
            SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(Input))) != inputs.Length)
            throw new WindowFailure("permission", "Windows could not insert the requested text");
        return new { };
    }

    private static void Main()
    {
        Console.InputEncoding = new UTF8Encoding(false);
        Console.OutputEncoding = new UTF8Encoding(false);
        // Set before any coordinate APIs so mixed-DPI monitors use physical pixels.
        try { if (!SetProcessDpiAwarenessContext(new IntPtr(-4))) SetProcessDpiAwareness(2); }
        catch (EntryPointNotFoundException) { SetProcessDpiAwareness(2); }
        string line;
        while ((line = Console.ReadLine()) != null)
        {
            object requestId = null;
            try
            {
                var request = Json.Deserialize<Dictionary<string, object>>(line);
                if (request == null) throw new WindowFailure("invalid", "Invalid native window request");
                request.TryGetValue("requestId", out requestId);
                Console.WriteLine(Json.Serialize(new { requestId = requestId, data = Dispatch(request) }));
            }
            catch (WindowFailure error)
            {
                Console.WriteLine(Json.Serialize(new { requestId = requestId, error = error.Message, errorCode = error.Code }));
            }
            catch (Exception error)
            {
                Console.Error.WriteLine(error.GetType().Name);
                Console.WriteLine(Json.Serialize(new { requestId = requestId, error = "Invalid or unavailable native window request", errorCode = "invalid" }));
            }
        }
    }
}
