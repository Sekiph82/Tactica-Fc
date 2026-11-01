use jni::JNIEnv;
use jni::objects::{JClass, JString};
use jni::sys::{JNI_FALSE, JNI_TRUE, jboolean};
use std::sync::atomic::{AtomicBool, Ordering};

static SERVER_STARTED: AtomicBool = AtomicBool::new(false);

#[unsafe(no_mangle)]
pub extern "system" fn Java_com_tacticafc_manager_MainActivity_nativeStartServer(
    mut env: JNIEnv,
    _class: JClass,
    data_directory: JString,
) -> jboolean {
    if SERVER_STARTED.load(Ordering::Acquire) {
        return JNI_TRUE;
    }

    let data_directory = match env.get_string(&data_directory) {
        Ok(value) => value.to_string_lossy().into_owned(),
        Err(error) => {
            log::error!("Android did not provide its private career directory: {error}");
            return JNI_FALSE;
        }
    };

    if SERVER_STARTED
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return JNI_TRUE;
    }

    // Keep career/world files in app-private storage and bind the local UI to
    // loopback. Capped pools reduce memory pressure without changing match logic.
    unsafe {
        std::env::set_var("TACTICA_DATA_DIR", data_directory);
        std::env::set_var("TACTICA_BIND_ADDRESS", "127.0.0.1");
        std::env::set_var("TACTICA_PORT", "5184");
        std::env::set_var("TACTICA_NO_BROWSER", "1");
        std::env::set_var("MATCH_EVENTS", "true");
        std::env::set_var("MATCH_PLAY_POOL_MAX_THREADS", "2");
        std::env::set_var("MATCH_STORE_POOL_MAX_THREADS", "1");
    }

    match std::thread::Builder::new()
        .name("tactica-open-football".to_owned())
        .spawn(open_football::run_server)
    {
        Ok(_) => JNI_TRUE,
        Err(error) => {
            log::error!("Failed to start the local Android match engine: {error}");
            SERVER_STARTED.store(false, Ordering::Release);
            JNI_FALSE
        }
    }
}
