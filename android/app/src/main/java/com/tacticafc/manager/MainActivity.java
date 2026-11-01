package com.tacticafc.manager;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    static {
        System.loadLibrary("tactica_android_engine");
    }

    private static native boolean nativeStartServer(String dataDirectory);

    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        nativeStartServer(getFilesDir().getAbsolutePath() + "/career-data");
        super.onCreate(savedInstanceState);
    }
}
