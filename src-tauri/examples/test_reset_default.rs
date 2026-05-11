use git2::Repository;
use std::fs;
use std::process::Command;

fn git_status(dir: &std::path::Path) -> String {
    let out = Command::new("git")
        .args(["status", "-sb"])
        .current_dir(dir)
        .output()
        .unwrap();
    String::from_utf8_lossy(&out.stdout).to_string()
}

fn main() {
    let dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("target/wise-git-reset-test");
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    Command::new("git")
        .args(["init"])
        .current_dir(&dir)
        .output()
        .expect("git init");
    fs::write(dir.join("f.txt"), "a").unwrap();
    Command::new("git")
        .args(["add", "f.txt"])
        .current_dir(&dir)
        .output()
        .expect("git add");

    println!("--- unborn HEAD: reset_default None ---");
    let repo = Repository::open(&dir).unwrap();
    for spec in [".", "*", ":/", "f.txt"] {
        Command::new("git")
            .args(["add", "f.txt"])
            .current_dir(&dir)
            .output()
            .ok();
        let r = repo.reset_default(None, [spec]);
        println!("  None [{spec:?}] => {r:?}  status: {}", git_status(&dir).trim_end());
    }

    println!("--- with commit: reset_default HEAD . ---");
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    Command::new("git")
        .args(["init"])
        .current_dir(&dir)
        .output()
        .unwrap();
    fs::write(dir.join("f.txt"), "a").unwrap();
    Command::new("git")
        .args(["add", "f.txt"])
        .current_dir(&dir)
        .output()
        .unwrap();
    Command::new("git")
        .args(["commit", "-m", "init"])
        .current_dir(&dir)
        .output()
        .unwrap();
    fs::write(dir.join("f.txt"), "b").unwrap();
    Command::new("git")
        .args(["add", "f.txt"])
        .current_dir(&dir)
        .output()
        .unwrap();
    println!("before: {}", git_status(&dir).trim_end());
    let repo = Repository::open(&dir).unwrap();
    let target = repo
        .head()
        .ok()
        .and_then(|h| h.peel_to_commit().ok())
        .map(|c| c.into_object());
    let r = repo.reset_default(target.as_ref(), ["." as &str]);
    println!("reset_default Some [.] => {r:?}");
    println!("after: {}", git_status(&dir).trim_end());
}
