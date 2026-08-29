mod protocol;

use std::collections::HashMap;
use std::io::{self, Read, Write};
use std::process::{ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex, mpsc};
use std::thread;
use std::time::{Duration, Instant};

use clap::{Parser, Subcommand};
use protocol::{Frame, FrameKind, PROTOCOL_VERSION, read_frame, write_frame};
use serde::{Deserialize, Serialize};

#[derive(Debug, Parser)]
#[command(
    name = "gdp-wsl-agent",
    version,
    about = "GitHub Desktop Plus WSL agent"
)]
struct Cli {
    #[command(subcommand)]
    command: AgentCommand,
}

#[derive(Debug, Subcommand)]
enum AgentCommand {
    /// Serve the versioned multiplexed protocol over stdin/stdout.
    Serve {
        /// Reserve stdout exclusively for protocol frames.
        #[arg(long)]
        stdio: bool,
    },
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HelloRequest {
    version: u16,
    client: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct HelloResponse<'a> {
    version: u16,
    agent_version: &'a str,
    os: &'a str,
    arch: &'a str,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SpawnRequest {
    args: Vec<String>,
    cwd: String,
    #[serde(default)]
    env: HashMap<String, String>,
}

#[derive(Debug, Serialize)]
struct SpawnResponse {
    pid: u32,
}

#[derive(Debug, Deserialize)]
struct KillRequest {
    #[serde(default = "default_signal")]
    signal: String,
}

#[derive(Debug, Serialize)]
struct ExitResponse {
    code: Option<i32>,
    signal: Option<String>,
}

#[derive(Debug, Serialize)]
struct ErrorResponse<'a> {
    code: &'a str,
    message: String,
}

#[derive(Debug)]
enum StdinMessage {
    Data(Vec<u8>),
    End,
}

#[derive(Debug)]
struct RunningProcess {
    pid: u32,
    stdin: mpsc::SyncSender<StdinMessage>,
}

type ProcessMap = Arc<Mutex<HashMap<u64, RunningProcess>>>;
type FrameSender = mpsc::SyncSender<Frame>;

const CLIENT_LIVENESS_TIMEOUT: Duration = Duration::from_secs(60);
const WATCHDOG_INTERVAL: Duration = Duration::from_secs(10);

fn default_signal() -> String {
    "SIGTERM".to_string()
}

fn error_frame(request_id: u64, code: &'static str, message: impl Into<String>) -> Frame {
    Frame::json(
        FrameKind::Error,
        request_id,
        &ErrorResponse {
            code,
            message: message.into(),
        },
    )
    .expect("serialize agent error")
}

fn writer_thread(receiver: mpsc::Receiver<Frame>) -> io::Result<()> {
    let stdout = io::stdout();
    let mut writer = stdout.lock();
    for frame in receiver {
        write_frame(&mut writer, &frame)?;
    }
    Ok(())
}

fn pipe_output(
    request_id: u64,
    kind: FrameKind,
    mut reader: impl Read + Send + 'static,
    sender: FrameSender,
) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        let mut buffer = vec![0_u8; 64 * 1024];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(length) => {
                    if sender
                        .send(Frame::new(kind, request_id, buffer[..length].to_vec()))
                        .is_err()
                    {
                        break;
                    }
                }
                Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
                Err(_) => break,
            }
        }
    })
}

fn pipe_stdin(mut stdin: ChildStdin, receiver: mpsc::Receiver<StdinMessage>) {
    for message in receiver {
        match message {
            StdinMessage::Data(bytes) => {
                if stdin.write_all(&bytes).is_err() {
                    break;
                }
            }
            StdinMessage::End => break,
        }
    }
}

#[cfg(unix)]
fn configure_process_group(command: &mut Command) {
    use std::os::unix::process::CommandExt;
    command.process_group(0);
}

#[cfg(not(unix))]
fn configure_process_group(_command: &mut Command) {}

fn spawn_git(request_id: u64, request: SpawnRequest, sender: &FrameSender, processes: &ProcessMap) {
    if request_id == 0
        || processes
            .lock()
            .expect("process map")
            .contains_key(&request_id)
    {
        let _ = sender.send(error_frame(
            request_id,
            "EEXIST",
            "request id is zero or already active",
        ));
        return;
    }
    if !request.cwd.starts_with('/') {
        let _ = sender.send(error_frame(
            request_id,
            "EINVAL",
            "cwd must be an absolute Linux path",
        ));
        return;
    }

    let mut command = Command::new("git");
    command
        .args(&request.args)
        .current_dir(&request.cwd)
        .envs(&request.env)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    configure_process_group(&mut command);

    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            let code = match error.kind() {
                io::ErrorKind::NotFound => "ENOENT",
                io::ErrorKind::PermissionDenied => "EACCES",
                _ => "ESPAWN",
            };
            let _ = sender.send(error_frame(request_id, code, error.to_string()));
            return;
        }
    };

    let pid = child.id();
    let Some(stdin) = child.stdin.take() else {
        let _ = sender.send(error_frame(request_id, "EPIPE", "child stdin unavailable"));
        return;
    };
    let Some(stdout) = child.stdout.take() else {
        let _ = sender.send(error_frame(request_id, "EPIPE", "child stdout unavailable"));
        return;
    };
    let Some(stderr) = child.stderr.take() else {
        let _ = sender.send(error_frame(request_id, "EPIPE", "child stderr unavailable"));
        return;
    };

    let (stdin_sender, stdin_receiver) = mpsc::sync_channel(64);
    processes.lock().expect("process map").insert(
        request_id,
        RunningProcess {
            pid,
            stdin: stdin_sender,
        },
    );

    if sender
        .send(
            Frame::json(FrameKind::Spawned, request_id, &SpawnResponse { pid })
                .expect("serialize spawn response"),
        )
        .is_err()
    {
        return;
    }

    thread::spawn(move || pipe_stdin(stdin, stdin_receiver));
    let stdout_thread = pipe_output(request_id, FrameKind::Stdout, stdout, sender.clone());
    let stderr_thread = pipe_output(request_id, FrameKind::Stderr, stderr, sender.clone());
    let sender = sender.clone();
    let processes = Arc::clone(processes);

    thread::spawn(move || {
        let status = child.wait();
        let _ = stdout_thread.join();
        let _ = stderr_thread.join();
        processes.lock().expect("process map").remove(&request_id);

        let response = match status {
            Ok(status) => ExitResponse {
                code: status.code(),
                signal: exit_signal(&status),
            },
            Err(error) => {
                let _ = sender.send(error_frame(request_id, "EWAIT", error.to_string()));
                return;
            }
        };
        let _ = sender.send(
            Frame::json(FrameKind::Exit, request_id, &response).expect("serialize exit response"),
        );
    });
}

#[cfg(unix)]
fn exit_signal(status: &std::process::ExitStatus) -> Option<String> {
    use std::os::unix::process::ExitStatusExt;
    status.signal().map(signal_name)
}

#[cfg(not(unix))]
fn exit_signal(_status: &std::process::ExitStatus) -> Option<String> {
    None
}

#[cfg(unix)]
fn signal_name(signal: i32) -> String {
    match signal {
        libc::SIGINT => "SIGINT".to_string(),
        libc::SIGKILL => "SIGKILL".to_string(),
        libc::SIGHUP => "SIGHUP".to_string(),
        libc::SIGQUIT => "SIGQUIT".to_string(),
        _ => "SIGTERM".to_string(),
    }
}

#[cfg(unix)]
fn kill_process_group(pid: u32, signal: &str) -> io::Result<()> {
    let signal = match signal {
        "SIGINT" => libc::SIGINT,
        "SIGKILL" => libc::SIGKILL,
        "SIGHUP" => libc::SIGHUP,
        "SIGQUIT" => libc::SIGQUIT,
        _ => libc::SIGTERM,
    };
    // SAFETY: kill is called with a valid signal and a negated child process
    // group id created by configure_process_group.
    if unsafe { libc::kill(-(pid as i32), signal) } == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

#[cfg(not(unix))]
fn kill_process_group(_pid: u32, _signal: &str) -> io::Result<()> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "gdp-wsl-agent only serves processes on Unix",
    ))
}

fn kill_all(processes: &ProcessMap) {
    let pids: Vec<_> = processes
        .lock()
        .expect("process map")
        .values()
        .map(|process| process.pid)
        .collect();
    for pid in pids {
        let _ = kill_process_group(pid, "SIGKILL");
    }
}

fn serve_stdio() -> io::Result<()> {
    let (sender, receiver) = mpsc::sync_channel::<Frame>(256);
    let writer = thread::spawn(move || writer_thread(receiver));
    let processes: ProcessMap = Arc::new(Mutex::new(HashMap::new()));
    let last_client_activity = Arc::new(Mutex::new(Instant::now()));
    {
        let processes = Arc::clone(&processes);
        let last_client_activity = Arc::clone(&last_client_activity);
        thread::spawn(move || {
            loop {
                thread::sleep(WATCHDOG_INTERVAL);
                let idle_for = last_client_activity
                    .lock()
                    .expect("client activity clock")
                    .elapsed();
                if idle_for >= CLIENT_LIVENESS_TIMEOUT {
                    kill_all(&processes);
                    std::process::exit(0);
                }
            }
        });
    }
    let stdin = io::stdin();
    let mut reader = stdin.lock();
    let mut handshake_complete = false;

    while let Some(frame) = read_frame(&mut reader)? {
        *last_client_activity.lock().expect("client activity clock") = Instant::now();
        match frame.kind {
            FrameKind::Hello => {
                let hello: HelloRequest = match serde_json::from_slice(&frame.payload) {
                    Ok(hello) => hello,
                    Err(error) => {
                        let _ = sender.send(error_frame(0, "EPROTO", error.to_string()));
                        continue;
                    }
                };
                if hello.version != PROTOCOL_VERSION {
                    let _ = sender.send(error_frame(
                        0,
                        "EPROTO_VERSION",
                        format!(
                            "client {} requested protocol {}, agent supports {}",
                            hello.client, hello.version, PROTOCOL_VERSION
                        ),
                    ));
                    continue;
                }
                handshake_complete = true;
                sender
                    .send(Frame::json(
                        FrameKind::HelloAck,
                        0,
                        &HelloResponse {
                            version: PROTOCOL_VERSION,
                            agent_version: env!("CARGO_PKG_VERSION"),
                            os: std::env::consts::OS,
                            arch: std::env::consts::ARCH,
                        },
                    )?)
                    .map_err(|_| {
                        io::Error::new(io::ErrorKind::BrokenPipe, "client disconnected")
                    })?;
            }
            _ if !handshake_complete => {
                let _ = sender.send(error_frame(
                    frame.request_id,
                    "EPROTO_HANDSHAKE",
                    "hello frame required before requests",
                ));
            }
            FrameKind::Spawn => match serde_json::from_slice(&frame.payload) {
                Ok(request) => spawn_git(frame.request_id, request, &sender, &processes),
                Err(error) => {
                    let _ = sender.send(error_frame(frame.request_id, "EPROTO", error.to_string()));
                }
            },
            FrameKind::Stdin => {
                if let Some(process) = processes
                    .lock()
                    .expect("process map")
                    .get(&frame.request_id)
                {
                    let _ = process.stdin.send(StdinMessage::Data(frame.payload));
                }
            }
            FrameKind::StdinEnd => {
                if let Some(process) = processes
                    .lock()
                    .expect("process map")
                    .get(&frame.request_id)
                {
                    let _ = process.stdin.send(StdinMessage::End);
                }
            }
            FrameKind::Kill => {
                let request: KillRequest =
                    serde_json::from_slice(&frame.payload).unwrap_or_else(|_| KillRequest {
                        signal: default_signal(),
                    });
                if let Some(process) = processes
                    .lock()
                    .expect("process map")
                    .get(&frame.request_id)
                    && let Err(error) = kill_process_group(process.pid, &request.signal)
                {
                    let _ = sender.send(error_frame(frame.request_id, "EKILL", error.to_string()));
                }
            }
            FrameKind::Ping => {
                let _ = sender.send(Frame::new(FrameKind::Pong, frame.request_id, frame.payload));
            }
            FrameKind::Shutdown => break,
            _ => {
                let _ = sender.send(error_frame(
                    frame.request_id,
                    "EPROTO_DIRECTION",
                    "frame kind is not valid from the client",
                ));
            }
        }
    }

    kill_all(&processes);
    drop(sender);
    match writer.join() {
        Ok(result) => result,
        Err(_) => Err(io::Error::other("protocol writer panicked")),
    }
}

fn main() {
    let result = match Cli::parse().command {
        AgentCommand::Serve { stdio: true } => serve_stdio(),
        AgentCommand::Serve { stdio: false } => Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "serve currently requires --stdio",
        )),
    };

    if let Err(error) = result {
        eprintln!("gdp-wsl-agent: {error}");
        std::process::exit(1);
    }
}
