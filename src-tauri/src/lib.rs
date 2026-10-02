// Application de bureau LeekWars Local : affiche l'interface et lance le serveur local embarqué
// (sidecar `leekwars-server.exe`, le serveur Node compilé en exécutable autonome).
use std::net::{SocketAddr, TcpStream};
use std::process::{Child, Command};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{Manager, RunEvent};

const SERVER_ADDR: &str = "127.0.0.1:3737";

struct ServerProcess(Mutex<Option<Child>>);

fn server_is_up() -> bool {
    let addr: SocketAddr = SERVER_ADDR.parse().unwrap();
    TcpStream::connect_timeout(&addr, Duration::from_millis(200)).is_ok()
}

/// Lance le serveur embarqué, sauf si un serveur tourne déjà (ex. `npm run server` en développement).
fn start_server(app: &tauri::App) -> Option<Child> {
    if server_is_up() {
        return None;
    }
    let exe_dir = std::env::current_exe().ok()?.parent()?.to_path_buf();
    let server = exe_dir.join(if cfg!(windows) { "leekwars-server.exe" } else { "leekwars-server" });
    if !server.exists() {
        eprintln!("Serveur embarqué introuvable : {}", server.display());
        return None;
    }
    // Données de l'utilisateur (base SQLite, sauvegardes) dans son dossier applicatif, ex. %APPDATA%\com.steodec.leekwarslocal
    let data_dir = app.path().app_data_dir().ok()?;
    std::fs::create_dir_all(&data_dir).ok()?;

    let mut cmd = Command::new(&server);
    cmd.env("LWL_DATA_DIR", &data_dir).env("LWL_ROOT", &data_dir).current_dir(&data_dir);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let child = cmd.spawn().map_err(|e| eprintln!("Lancement du serveur impossible : {e}")).ok()?;

    // Attend que le serveur réponde pour que l'interface ne démarre pas sur une erreur.
    let start = Instant::now();
    while !server_is_up() && start.elapsed() < Duration::from_secs(15) {
        std::thread::sleep(Duration::from_millis(100));
    }
    Some(child)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let child = start_server(app);
            app.manage(ServerProcess(Mutex::new(child)));
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                if let Some(mut child) = app.state::<ServerProcess>().0.lock().unwrap().take() {
                    let _ = child.kill();
                }
            }
        });
}
