//! The call window (ZaloCall draws its own Qt windows; this is the GTK 3 stand-in Tauri already links on Linux).

use gtk::gdk_pixbuf::{Colorspace, InterpType, Pixbuf};
use gtk::prelude::*;

use super::media::Frame;

const CSS: &str = "
window.zcall { background: #1b1d21; color: #f1f2f4; }
window.zcall .name { font-size: 20px; font-weight: bold; }
window.zcall .status { color: #b5b9c0; }
window.zcall button { border-radius: 22px; padding: 8px 18px; color: #fff; background: #3a3d44; border: none; box-shadow: none; }
window.zcall button.accept { background: #22a55b; }
window.zcall button.hangup { background: #e5383b; }
window.zcall button:checked { background: #f1f2f4; color: #1b1d21; }
";

pub struct Ui {
    pub window: gtk::Window,
    status: gtk::Label,
    remote: gtk::Image,
    local: gtk::Image,
    answer_row: gtk::Box,
    call_row: gtk::Box,
    pub accept: gtk::Button,
    pub accept_video: gtk::Button,
    pub reject: gtk::Button,
    pub mic_off: gtk::ToggleButton,
    pub cam_off: gtk::ToggleButton,
    pub hang_up: gtk::Button,
}

fn button(label: &str, class: &str) -> gtk::Button {
    let b = gtk::Button::with_label(label);
    if !class.is_empty() {
        b.style_context().add_class(class);
    }
    b
}

impl Ui {
    pub fn new(name: &str, video: bool, incoming: bool) -> Ui {
        let css = gtk::CssProvider::new();
        let _ = css.load_from_data(CSS.as_bytes());
        if let Some(screen) = gtk::gdk::Screen::default() {
            gtk::StyleContext::add_provider_for_screen(&screen, &css, gtk::STYLE_PROVIDER_PRIORITY_APPLICATION);
        }

        let window = gtk::Window::new(gtk::WindowType::Toplevel);
        window.style_context().add_class("zcall");
        window.set_title(&format!("{} – {name}", if video { "Cuộc gọi video" } else { "Cuộc gọi thoại" }));
        window.set_default_size(if video { 720 } else { 360 }, if video { 520 } else { 260 });
        window.set_position(gtk::WindowPosition::Center);
        window.set_keep_above(incoming);

        let root = gtk::Box::new(gtk::Orientation::Vertical, 10);
        root.set_border_width(16);
        let remote = gtk::Image::new();
        let local = gtk::Image::new();
        local.set_halign(gtk::Align::End);
        local.set_valign(gtk::Align::End);
        local.set_margin_end(8);
        local.set_margin_bottom(8);
        let screen = gtk::Overlay::new();
        screen.add(&remote);
        screen.add_overlay(&local);
        screen.set_no_show_all(!video);
        root.pack_start(&screen, video, true, 0);

        let title = gtk::Label::new(Some(name));
        title.style_context().add_class("name");
        let status = gtk::Label::new(None);
        status.style_context().add_class("status");
        root.pack_start(&title, !video, false, 0);
        root.pack_start(&status, false, false, 0);

        let answer_row = gtk::Box::new(gtk::Orientation::Horizontal, 12);
        answer_row.set_halign(gtk::Align::Center);
        let (accept, accept_video, reject) = (button("Trả lời", "accept"), button("Trả lời bằng video", "accept"), button("Từ chối", "hangup"));
        answer_row.pack_start(&accept, false, false, 0);
        if video {
            answer_row.pack_start(&accept_video, false, false, 0);
        }
        answer_row.pack_start(&reject, false, false, 0);

        let call_row = gtk::Box::new(gtk::Orientation::Horizontal, 12);
        call_row.set_halign(gtk::Align::Center);
        let mic_off = gtk::ToggleButton::with_label("Tắt mic");
        let cam_off = gtk::ToggleButton::with_label("Tắt camera");
        let hang_up = button("Kết thúc", "hangup");
        call_row.pack_start(&mic_off, false, false, 0);
        if video {
            call_row.pack_start(&cam_off, false, false, 0);
        }
        call_row.pack_start(&hang_up, false, false, 0);
        mic_off.connect_toggled(|b| b.set_label(if b.is_active() { "Bật mic" } else { "Tắt mic" }));
        cam_off.connect_toggled(|b| b.set_label(if b.is_active() { "Bật camera" } else { "Tắt camera" }));

        root.pack_end(&call_row, false, false, 0);
        root.pack_end(&answer_row, false, false, 0);
        window.add(&root);
        window.show_all();
        let ui = Ui { window, status, remote, local, answer_row, call_row, accept, accept_video, reject, mic_off, cam_off, hang_up };
        ui.ringing(incoming);
        ui
    }

    fn ringing(&self, incoming: bool) {
        self.answer_row.set_visible(incoming);
        self.call_row.set_visible(!incoming);
        self.mic_off.set_sensitive(!incoming);
    }

    pub fn status(&self, text: &str) {
        self.status.set_text(text);
    }

    /// Answer buttons give way to the in-call controls.
    pub fn connected(&self) {
        self.answer_row.set_visible(false);
        self.call_row.set_visible(true);
        self.mic_off.set_sensitive(true);
    }

    pub fn finished(&self, text: &str) {
        self.status(text);
        self.answer_row.set_sensitive(false);
        self.call_row.set_sensitive(false);
    }

    pub fn show(&self, f: Frame) {
        let pixbuf = Pixbuf::from_mut_slice(f.rgba, Colorspace::Rgb, true, 8, f.width, f.height, f.width * 4);
        let (image, max_w, max_h) = if f.local {
            (&self.local, 200, 150)
        } else {
            let area = self.remote.parent().map(|p| p.allocation()).map_or((640, 360), |a| (a.width(), a.height()));
            (&self.remote, area.0.max(640), area.1.max(360))
        };
        let scale = (max_w as f64 / f.width as f64).min(max_h as f64 / f.height as f64);
        let (w, h) = (((f.width as f64 * scale) as i32).max(1), ((f.height as f64 * scale) as i32).max(1));
        image.set_from_pixbuf(pixbuf.scale_simple(w, h, InterpType::Bilinear).as_ref());
    }
}
