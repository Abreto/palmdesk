using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

internal static class NativeMethods
{
    [StructLayout(LayoutKind.Sequential)]
    internal struct Rect
    {
        internal int Left, Top, Right, Bottom;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct Point
    {
        internal int X, Y;
    }

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool SetProcessDpiAwarenessContext(IntPtr context);

    [DllImport("shcore.dll")]
    internal static extern int SetProcessDpiAwareness(int awareness);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool SetProcessDPIAware();

    [DllImport("dwmapi.dll")]
    internal static extern int DwmGetWindowAttribute(
        IntPtr window, int attribute, out Rect rect, int size);

    [DllImport("dwmapi.dll")]
    internal static extern int DwmFlush();

    [DllImport("user32.dll")]
    internal static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool GetCursorPos(out Point point);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool IsIconic(IntPtr window);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool IsWindowVisible(IntPtr window);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool ShowWindow(IntPtr window, int command);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool SetWindowPos(
        IntPtr window, IntPtr insertAfter, int x, int y, int width, int height,
        uint flags);

    internal static void EnablePhysicalCoordinates()
    {
        try
        {
            if (SetProcessDpiAwarenessContext(new IntPtr(-4))) return;
        }
        catch (EntryPointNotFoundException) { }
        try
        {
            if (SetProcessDpiAwareness(2) == 0) return;
        }
        catch (DllNotFoundException) { }
        catch (EntryPointNotFoundException) { }
        if (!SetProcessDPIAware())
            throw new InvalidOperationException("Cannot enable physical coordinates");
    }
}

internal sealed class TestWindow : Form
{
    internal readonly TextBox Input = new TextBox();
    internal int ClickCount;
    internal int InputClickCount;

    internal TestWindow(Rectangle bounds, Color color)
    {
        Text = "PalmDesk native smoke fixture";
        AutoScaleMode = AutoScaleMode.None;
        StartPosition = FormStartPosition.Manual;
        Bounds = bounds;
        BackColor = color;
        ShowInTaskbar = true;
        Input.Location = new System.Drawing.Point(20, 20);
        Input.Size = new Size(200, 26);
        Input.ImeMode = ImeMode.On;
        Input.MouseClick += delegate { ClickCount++; InputClickCount++; };
        MouseClick += delegate { ClickCount++; };
        Controls.Add(Input);
    }

    protected override bool ShowWithoutActivation
    {
        get { return true; }
    }
}

internal sealed class FixtureContext : ApplicationContext
{
    private readonly Control dispatcher = new Control();
    private readonly TestWindow[] windows = new TestWindow[2];
    private readonly long[] handles = new long[2];
    private readonly int ownerPid = Process.GetCurrentProcess().Id;
    private bool stopping;

    internal FixtureContext()
    {
        // A separate dispatcher keeps stdin usable after either or both forms close.
        IntPtr dispatcherHandle = dispatcher.Handle;
        Rectangle work = Screen.PrimaryScreen.WorkingArea;
        int width = Math.Min(400, Math.Max(160, work.Width - 64));
        int height = Math.Min(280, Math.Max(120, work.Height - 64));
        for (int index = 0; index < windows.Length; index++)
        {
            Rectangle bounds = new Rectangle(
                work.Left + 24 + index * 20,
                work.Top + 24 + index * 20, width, height);
            windows[index] = new TestWindow(
                bounds, index == 0 ? Color.SeaGreen : Color.IndianRed);
            windows[index].Show();
            handles[index] = windows[index].Handle.ToInt64();
        }
        Write(new { requestId = 0, data = Snapshot() });
        Thread reader = new Thread(ReadCommands);
        reader.IsBackground = true;
        reader.Start();
    }

    private static void Write(object value)
    {
        Console.Out.WriteLine(new JavaScriptSerializer().Serialize(value));
        Console.Out.Flush();
    }

    private object Snapshot()
    {
        NativeMethods.DwmFlush();
        List<object> state = new List<object>();
        for (int index = 0; index < windows.Length; index++)
        {
            TestWindow window = windows[index];
            bool closed = window.IsDisposed;
            object bounds = null;
            object inputBounds = null;
            if (!closed)
            {
                NativeMethods.Rect rect;
                int result = NativeMethods.DwmGetWindowAttribute(
                    window.Handle, 9, out rect, Marshal.SizeOf(typeof(NativeMethods.Rect)));
                if (result != 0)
                    throw new InvalidOperationException("Cannot read physical DWM frame");
                bounds = new
                {
                    x = rect.Left,
                    y = rect.Top,
                    width = rect.Right - rect.Left,
                    height = rect.Bottom - rect.Top
                };
                Rectangle input = window.Input.RectangleToScreen(window.Input.ClientRectangle);
                inputBounds = new
                {
                    x = input.X, y = input.Y, width = input.Width, height = input.Height
                };
            }
            state.Add(new
            {
                nativeId = handles[index],
                ownerPid = ownerPid,
                name = "PalmDesk native smoke fixture",
                closed = closed,
                isMinimized = !closed && NativeMethods.IsIconic(window.Handle),
                isVisible = !closed && NativeMethods.IsWindowVisible(window.Handle),
                bounds = bounds,
                inputBounds = inputBounds,
                text = closed ? null : window.Input.Text,
                clickCount = window.ClickCount,
                inputClickCount = window.InputClickCount,
                inputFocused = !closed && window.Input.Focused
            });
        }
        NativeMethods.Point cursor;
        bool hasCursor = NativeMethods.GetCursorPos(out cursor);
        return new
        {
            ownerPid = ownerPid,
            foregroundNativeId = NativeMethods.GetForegroundWindow().ToInt64(),
            cursor = hasCursor ? new { x = cursor.X, y = cursor.Y } : null,
            windows = state
        };
    }

    private TestWindow OwnedWindow(Dictionary<string, object> request)
    {
        long nativeId = Convert.ToInt64(request["nativeId"]);
        for (int index = 0; index < windows.Length; index++)
        {
            if (handles[index] == nativeId && !windows[index].IsDisposed)
                return windows[index];
        }
        throw new ArgumentException("Only live fixture-owned HWNDs are accepted");
    }

    private void Dispatch(Dictionary<string, object> request)
    {
        object requestId = null;
        try
        {
            requestId = request["requestId"];
            string command = Convert.ToString(request["command"]);
            bool quit = false;
            switch (command)
            {
                case "status":
                    break;
                case "minimize":
                    NativeMethods.ShowWindow(OwnedWindow(request).Handle, 7);
                    break;
                case "move":
                    TestWindow window = OwnedWindow(request);
                    Dictionary<string, object> bounds =
                        (Dictionary<string, object>)request["bounds"];
                    int width = Convert.ToInt32(bounds["width"]);
                    int height = Convert.ToInt32(bounds["height"]);
                    if (width <= 0 || height <= 0) throw new ArgumentException();
                    if (!NativeMethods.SetWindowPos(
                        window.Handle, IntPtr.Zero,
                        Convert.ToInt32(bounds["x"]), Convert.ToInt32(bounds["y"]),
                        width, height, 0x0004 | 0x0010))
                        throw new InvalidOperationException("Cannot move fixture HWND");
                    break;
                case "close":
                    OwnedWindow(request).Close();
                    break;
                case "quit":
                    quit = true;
                    break;
                default:
                    throw new ArgumentException("Unknown fixture command");
            }
            Write(new { requestId = requestId, data = Snapshot() });
            if (quit) Shutdown();
        }
        catch (Exception)
        {
            Write(new
            {
                requestId = requestId,
                error = "Invalid fixture request or unavailable fixture window",
                errorCode = "invalid"
            });
        }
    }

    private void ReadCommands()
    {
        try
        {
            string line;
            while ((line = Console.ReadLine()) != null)
            {
                Dictionary<string, object> request;
                try
                {
                    request = new JavaScriptSerializer()
                        .Deserialize<Dictionary<string, object>>(line);
                    if (request == null) throw new ArgumentException();
                }
                catch (Exception)
                {
                    Write(new
                    {
                        requestId = (object)null,
                        error = "Invalid fixture JSON",
                        errorCode = "invalid"
                    });
                    continue;
                }
                dispatcher.Invoke(new Action(() => Dispatch(request)));
            }
        }
        catch (InvalidOperationException) { }
        catch (System.IO.IOException) { }
        finally
        {
            try { dispatcher.BeginInvoke(new Action(Shutdown)); }
            catch (InvalidOperationException) { }
        }
    }

    private void Shutdown()
    {
        if (stopping) return;
        stopping = true;
        foreach (TestWindow window in windows)
            if (window != null && !window.IsDisposed) window.Close();
        dispatcher.Dispose();
        ExitThread();
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) Shutdown();
        base.Dispose(disposing);
    }
}

internal static class Program
{
    [STAThread]
    private static int Main()
    {
        try
        {
            Console.OutputEncoding = new System.Text.UTF8Encoding(false);
            Console.InputEncoding = new System.Text.UTF8Encoding(false);
            NativeMethods.EnablePhysicalCoordinates();
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            using (FixtureContext context = new FixtureContext())
                Application.Run(context);
            return 0;
        }
        catch (Exception)
        {
            Console.Error.WriteLine("Windows smoke fixture could not start");
            return 1;
        }
    }
}
