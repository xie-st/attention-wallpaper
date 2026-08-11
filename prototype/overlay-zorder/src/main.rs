// Throwaway prototype — validates z-order technique for the Overlay Window (issue #9 / ADR-0024).
// NOT production code. No tests, no polish. Delete or absorb the verdict into NOTES.md after HITL.
//
// Question: which of two Win32 z-order strategies satisfies ALL of:
//   1. overlay renders above wallpaper (visible)
//   2. desktop icons remain clickable
//   3. the "pet" rect receives double-click (core rewind/advance gesture)
//   4. opening a normal window (Notepad) covers the overlay; Win+D reveals it
//
// Strategy A (`--workerw`): SetParent(overlay, WorkerW) — overlay rendered BEHIND
//   the desktop icon listview (SHELLDLL_DefView). Hypothesis: icons clickable but
//   SHELLDLL_DefView eats empty-desktop clicks, so pet double-click never arrives.
//
// Strategy B (`--hittest`): top-level HWND_BOTTOM + WS_EX_LAYERED + WM_NCHITTEST
//   returning HTTRANSPARENT everywhere except the pet rect. Hypothesis: overlay sits
//   just above the desktop icons (HWND_BOTTOM is above Progman/defview), forwards all
//   non-pet clicks to the icons, captures pet clicks. Classic desktop-pet technique.

use std::env;
use std::io::{self, Write};
use std::ffi::c_void;
use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, RECT, WPARAM};
use windows_sys::Win32::Graphics::Gdi::{
    BeginPaint, CreateSolidBrush, DeleteObject, EndPaint, FillRect, InvalidateRect, ScreenToClient,
    PAINTSTRUCT,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DispatchMessageW, EnumWindows, FindWindowExW, FindWindowW,
    GetClientRect, GetMessageW, GetWindow, GetWindowRect, IsWindowVisible, LoadCursorW,
    PostQuitMessage, RegisterClassW, SendMessageTimeoutW, SetLayeredWindowAttributes, SetParent,
    SetWindowPos, ShowWindow, SystemParametersInfoW, TranslateMessage, CS_DBLCLKS,
    GW_HWNDNEXT, GW_HWNDPREV, HWND_BOTTOM, HWND_TOP, HTCLIENT, HTTRANSPARENT, LWA_COLORKEY, MSG,
    SMTO_NORMAL,
    SPI_GETWORKAREA, SWP_NOACTIVATE, SWP_NOOWNERZORDER, SWP_NOSIZE, SWP_SHOWWINDOW, WM_ERASEBKGND,
    WM_LBUTTONDBLCLK, WM_LBUTTONDOWN, WM_NCHITTEST, WM_PAINT, WM_RBUTTONDOWN, WNDCLASSW,
    WS_EX_LAYERED, WS_EX_TOOLWINDOW, WS_POPUP, WS_VISIBLE,
};

type COLORREF = u32;
const BG_KEY: COLORREF = 0x0000FF00; // green -> color-keyed transparent
const PET_COLOR: COLORREF = 0x000000FF; // red, opaque
const PET_W: i32 = 96;
const PET_H: i32 = 96;

#[derive(Clone, Copy, PartialEq)]
enum Strategy {
    WorkerW,
    HitTest,
}

static mut STRATEGY: Strategy = Strategy::HitTest;
static mut PET_RECT: RECT = RECT { left: 0, top: 0, right: 0, bottom: 0 };
static mut FOUND_WORKERW: HWND = std::ptr::null_mut();
static mut defview_global: HWND = std::ptr::null_mut();
static mut defview_parent_global: HWND = std::ptr::null_mut();
static mut first_workerw_no_defview: HWND = std::ptr::null_mut();

// Enumerate all top-level windows; log every WorkerW (with/without SHELLDLL_DefView)
// and record the first SHELLDLL_DefView found + the first WorkerW WITHOUT defview.
unsafe extern "system" fn enum_log_top_level(hwnd: HWND, _lparam: LPARAM) -> i32 {
    let mut cls = [0u16; 64];
    let n = windows_sys::Win32::UI::WindowsAndMessaging::GetClassNameW(hwnd, cls.as_mut_ptr(), 64);
    let name = String::from_utf16_lossy(&cls[..n as usize]);
    if name == "WorkerW" || name == "Progman" {
        let shell = FindWindowExW(
            hwnd,
            std::ptr::null_mut(),
            wide("SHELLDLL_DefView").as_ptr(),
            std::ptr::null(),
        );
        log(&format!(
            "[enum] top-level hwnd={:#x} class='{}' -> has SHELLDLL_DefView child={:#x}",
            hwnd as usize,
            name,
            shell as usize
        ));
        if !shell.is_null() && defview_global.is_null() {
            defview_global = shell;
            defview_parent_global = hwnd;
        }
        if name == "WorkerW" && shell.is_null() && first_workerw_no_defview.is_null() {
            first_workerw_no_defview = hwnd;
        }
    }
    1
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

unsafe fn log(msg: &str) {
    println!("{}", msg);
    let _ = io::stdout().flush();
}

unsafe extern "system" fn wnd_proc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    match msg {
        WM_PAINT => {
            let mut ps: PAINTSTRUCT = std::mem::zeroed();
            let dc = BeginPaint(hwnd, &mut ps);
            if !dc.is_null() {
                let mut rc: RECT = std::mem::zeroed();
                GetClientRect(hwnd, &mut rc);
                let bg = CreateSolidBrush(BG_KEY);
                FillRect(dc, &rc, bg);
                DeleteObject(bg);
                let pet = CreateSolidBrush(PET_COLOR);
                let pr = std::ptr::read_volatile(&PET_RECT);
                FillRect(dc, &pr, pet);
                DeleteObject(pet);
                EndPaint(hwnd, &ps);
            }
            0
        }
        WM_ERASEBKGND => 1,
        WM_NCHITTEST => {
            // Both strategies use selective hit-test: pet rect = HTCLIENT (clickable),
            // everywhere else = HTTRANSPARENT (clicks pass through to whatever is below —
            // desktop icons for the Progman-parent case, other windows for the top-level case).
            let mut pt = POINT {
                x: (lparam as u32 & 0xFFFF) as i16 as i32,
                y: ((lparam as u32 >> 16) & 0xFFFF) as i16 as i32,
            };
            ScreenToClient(hwnd, &mut pt);
            let pr = std::ptr::read_volatile(&PET_RECT);
            if pt.x >= pr.left && pt.x < pr.right && pt.y >= pr.top && pt.y < pr.bottom {
                HTCLIENT as LRESULT
            } else {
                HTTRANSPARENT as LRESULT
            }
        }
        WM_LBUTTONDOWN => {
            let x = (lparam as u32 & 0xFFFF) as i16 as i32;
            let y = ((lparam as u32 >> 16) & 0xFFFF) as i16 as i32;
            let pr = std::ptr::read_volatile(&PET_RECT);
            let on_pet = x >= pr.left && x < pr.right && y >= pr.top && y < pr.bottom;
            log(&format!("[overlay] WM_LBUTTONDOWN at ({},{}) on_pet={}", x, y, on_pet));
            0
        }
        WM_LBUTTONDBLCLK => {
            let x = (lparam as u32 & 0xFFFF) as i16 as i32;
            let y = ((lparam as u32 >> 16) & 0xFFFF) as i16 as i32;
            let pr = std::ptr::read_volatile(&PET_RECT);
            let on_pet = x >= pr.left && x < pr.right && y >= pr.top && y < pr.bottom;
            log(&format!(
                "[overlay] *** WM_LBUTTONDBLCLK at ({},{}) on_pet={} ***",
                x, y, on_pet
            ));
            0
        }
        WM_RBUTTONDOWN => {
            log("[overlay] WM_RBUTTONDOWN -> quit");
            PostQuitMessage(0);
            0
        }
        _ => DefWindowProcW(hwnd, msg, wparam, lparam),
    }
}

unsafe extern "system" fn enum_find_workerw(hwnd: HWND, _lparam: LPARAM) -> i32 {
    // Find a WorkerW whose child is SHELLDLL_DefView; the NEXT top-level WorkerW
    // after it is the wallpaper-painting one we want to parent to.
    let shell = FindWindowExW(
        hwnd,
        std::ptr::null_mut(),
        wide("SHELLDLL_DefView").as_ptr(),
        std::ptr::null(),
    );
    if !shell.is_null() {
        let next = FindWindowExW(
            std::ptr::null_mut(),
            hwnd,
            wide("WorkerW").as_ptr(),
            std::ptr::null(),
        );
        if !next.is_null() {
            log(&format!(
                "[workerw] SHELLDLL_DefView={:#x} inside WorkerW={:#x}; wallpaper WorkerW={:#x}",
                shell as usize, hwnd as usize, next as usize
            ));
            std::ptr::write_volatile(&mut FOUND_WORKERW, next);
            return 0; // stop enum
        }
    }
    1 // continue
}

fn main() {
    let args: Vec<String> = env::args().collect();
    let strat = match args.get(1).map(|s| s.as_str()) {
        Some("--workerw") => Strategy::WorkerW,
        Some("--hittest") | None => Strategy::HitTest,
        other => {
            eprintln!(
                "usage: overlay-zorder-proto --workerw | --hittest   (got {:?})",
                other
            );
            std::process::exit(2);
        }
    };
    unsafe { STRATEGY = strat };

    let strat_name = if strat == Strategy::WorkerW {
        "workerw"
    } else {
        "hittest"
    };
    println!("==============================================================");
    println!("AW overlay z-order prototype  —  strategy: {}", strat_name);
    println!("==============================================================");
    println!("A translucent-green overlay covers the work area; a solid-red");
    println!("\"pet\" square sits near the center-bottom. Watch THIS console for click logs.");
    println!();
    println!("Perform these checks and write the verdict in NOTES.md:");
    println!("  1. Click a desktop icon       -> icon should open/select (icons usable?)");
    println!("  2. Double-click the RED pet   -> console should print WM_LBUTTONDBLCLK");
    println!("  3. Double-click empty desktop -> does console log a click? (B=yes, A=no?)");
    println!("  4. Open Notepad over the area -> overlay hidden under Notepad?");
    println!("  5. Win+D                      -> overlay reappears, icons still usable?");
    println!();
    println!("Right-click the overlay (if reachable) OR Ctrl+C here to quit.");
    println!("--------------------------------------------------------------");

    unsafe {
        let class_name = wide("AWProtoOverlay");
        let wc = WNDCLASSW {
            style: CS_DBLCLKS,
            lpfnWndProc: Some(wnd_proc),
            hInstance: std::ptr::null_mut(),
            lpszClassName: class_name.as_ptr(),
            hCursor: LoadCursorW(std::ptr::null_mut(), 32512 as *const u16), // IDC_ARROW
            hbrBackground: std::ptr::null_mut(),
            cbClsExtra: 0,
            cbWndExtra: 0,
            hIcon: std::ptr::null_mut(),
            lpszMenuName: std::ptr::null(),
        };
        RegisterClassW(&wc);

        let mut work: RECT = std::mem::zeroed();
        SystemParametersInfoW(SPI_GETWORKAREA, 0, &mut work as *mut _ as *mut _, 0);
        let wx = work.left;
        let wy = work.top;
        let ww = work.right - work.left;
        let wh = work.bottom - work.top;
        println!("[init] work area = ({},{}) {}x{}", wx, wy, ww, wh);

        let ex = WS_EX_LAYERED | WS_EX_TOOLWINDOW;
        let style: u32 = WS_POPUP | WS_VISIBLE;
        let hwnd = CreateWindowExW(
            ex,
            class_name.as_ptr(),
            wide("AW proto").as_ptr(),
            style,
            wx,
            wy,
            ww,
            wh,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null(),
        );
        if hwnd.is_null() {
            eprintln!("[init] CreateWindowExW failed");
            std::process::exit(1);
        }

        // color-key transparency: green -> see-through, red pet -> opaque. The window
        // still RECEIVES clicks on green areas unless WM_NCHITTEST (strategy B) returns
        // HTTRANSPARENT.
        SetLayeredWindowAttributes(hwnd, BG_KEY, 255, LWA_COLORKEY);

        // Pet at horizontal-center, 2/3 down (typical pet spot). Screen coords; the
        // hit-test handler converts to client via ScreenToClient.
        let pet_x = wx + (ww - PET_W) / 2;
        let pet_y = wy + (wh * 2 / 3 - PET_H / 2);
        PET_RECT = RECT {
            left: pet_x,
            top: pet_y,
            right: pet_x + PET_W,
            bottom: pet_y + PET_H,
        };

        // Push to bottom so normal windows cover it.
        SetWindowPos(
            hwnd,
            HWND_BOTTOM,
            0,
            0,
            0,
            0,
            SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER,
        );
        ShowWindow(hwnd, 5); // SW_SHOW

        if strat == Strategy::WorkerW {
            let progman = FindWindowW(wide("Progman").as_ptr(), std::ptr::null());
            log(&format!("[workerw] Progman hwnd = {:#x}", progman as usize));
            if progman.is_null() {
                eprintln!("[workerw] Progman not found; cannot apply SetParent strategy");
            } else {
                let mut result: usize = 0;
                let ok = SendMessageTimeoutW(
                    progman,
                    0x052C, // notify Progman to spawn WorkerW
                    0,
                    0,
                    SMTO_NORMAL,
                    1000,
                    &mut result,
                );
                log(&format!("[workerw] SendMessage(0x052C) returned {}", ok));

                defview_global = std::ptr::null_mut();
                defview_parent_global = std::ptr::null_mut();
                first_workerw_no_defview = std::ptr::null_mut();
                EnumWindows(Some(enum_log_top_level), 0);
                log(&format!(
                    "[workerw] scan results: defview={:#x} (parent={:#x}), workerw_no_defview={:#x}",
                    defview_global as usize,
                    defview_parent_global as usize,
                    first_workerw_no_defview as usize
                ));

                // Test the Progman-sibling strategy: SetParent(overlay, Progman), then
                // z-order overlay just ABOVE SHELLDLL_DefView so icons (in defview) remain
                // clickable via WS_EX_LAYERED + WM_NCHITTEST HTTRANSPARENT passthrough.
                let target = progman;
                log(&format!(
                    "[workerw] SetParent(overlay={:#x}, target={:#x})",
                    hwnd as usize,
                    target as usize
                ));
                let prev = SetParent(hwnd, target);
                log(&format!("[workerw] prev parent={:#x}", prev as usize));

                // Diagnostics: Progman + overlay + defview rects + IsWindowVisible.
                let mut pr_rect: RECT = std::mem::zeroed();
                let _ = windows_sys::Win32::UI::WindowsAndMessaging::GetWindowRect(target, &mut pr_rect);
                log(&format!(
                    "[workerw] Progman rect = ({},{}) {}x{} visible={}",
                    pr_rect.left,
                    pr_rect.top,
                    pr_rect.right - pr_rect.left,
                    pr_rect.bottom - pr_rect.top,
                    windows_sys::Win32::UI::WindowsAndMessaging::IsWindowVisible(target)
                ));

                SetWindowPos(
                    hwnd,
                    std::ptr::null_mut(),
                    0,
                    0,
                    pr_rect.right - pr_rect.left,
                    pr_rect.bottom - pr_rect.top,
                    SWP_NOACTIVATE | SWP_NOOWNERZORDER | SWP_SHOWWINDOW,
                );

                let mut ov_rect: RECT = std::mem::zeroed();
                let _ = windows_sys::Win32::UI::WindowsAndMessaging::GetWindowRect(hwnd, &mut ov_rect);
                log(&format!(
                    "[workerw] overlay rect after setpos = ({},{}) {}x{} visible={}",
                    ov_rect.left,
                    ov_rect.top,
                    ov_rect.right - ov_rect.left,
                    ov_rect.bottom - ov_rect.top,
                    windows_sys::Win32::UI::WindowsAndMessaging::IsWindowVisible(hwnd)
                ));

                // Reposition pet to be inside the actual overlay rect (center, 2/3 down).
                let ow = ov_rect.right - ov_rect.left;
                let oh = ov_rect.bottom - ov_rect.top;
                let pet_x = (ow - PET_W) / 2;
                let pet_y = (oh * 2 / 3 - PET_H / 2);
                PET_RECT = RECT {
                    left: pet_x,
                    top: pet_y,
                    right: pet_x + PET_W,
                    bottom: pet_y + PET_H,
                };
                log(&format!(
                    "[workerw] pet rect repositioned to ({},{}) {}x{} (client coords)",
                    pet_x,
                    pet_y,
                    PET_W,
                    PET_H
                ));

                if target == progman && !defview_global.is_null() {
                    // Bring overlay to top of Progman's child z-order.
                    let r1 = SetWindowPos(
                        hwnd,
                        windows_sys::Win32::UI::WindowsAndMessaging::HWND_TOP,
                        0,
                        0,
                        0,
                        0,
                        SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER,
                    );
                    log(&format!("[workerw] SetWindowPos(overlay, HWND_TOP) returned {}", r1));

                    // Verify z-order: is defview now below overlay?
                    let gw = windows_sys::Win32::UI::WindowsAndMessaging::GetWindow(
                        defview_global,
                        windows_sys::Win32::UI::WindowsAndMessaging::GW_HWNDNEXT,
                    );
                    log(&format!(
                        "[workerw] after HWND_TOP: defview's GW_HWNDNEXT = {:#x} (overlay = {:#x})",
                        gw as usize,
                        hwnd as usize
                    ));
                    // Also log defview's GW_HWNDPREV (sibling above it).
                    let gp = windows_sys::Win32::UI::WindowsAndMessaging::GetWindow(
                        defview_global,
                        windows_sys::Win32::UI::WindowsAndMessaging::GW_HWNDPREV,
                    );
                    log(&format!(
                        "[workerw] defview's GW_HWNDPREV = {:#x} (should == overlay if overlapped)",
                        gp as usize
                    ));
                    let _ = SWP_NOSIZE;
                }

                InvalidateRect(hwnd, std::ptr::null(), 1);
            }
        }

        InvalidateRect(hwnd, std::ptr::null(), 1);

        let mut msg: MSG = std::mem::zeroed();
        while GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) > 0 {
            TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
    }
}
