// ===== Apps the phone turns off =====
// Same list as debloat-list.txt in the repo (keep them in sync).
// Never add: com.amazon.firebat, com.amazon.tv.launcher, com.amazon.firehomestarter,
// com.amazon.tv.devicecontrol, com.amazon.tv.inputpreference.service, com.amazon.venezia,
// com.amazon.device.messaging, com.amazon.whisperjoin.*, com.amazon.whisperlink.core.android.

enum DebloatList {
    static let packages: [String] = [
        // Ads, promos, tracking
        "com.amazon.ftvads.deeplinking", "com.amazon.hybridadidservice", "com.amazon.kso.blackbird",
        "com.amazon.sneakpeek", "com.amazon.tv.acr",
        // Telemetry and logs
        "com.amazon.device.metrics", "com.amazon.device.telemetry.emitter", "com.amazon.wirelessmetrics.service",
        "com.amazon.device.logmanager", "com.amazon.dp.logger", "com.amazon.device.crashmanager",
        "com.amazon.perfcollection",
        // Shopping, tutorials, extras
        "com.amazon.shoptv.client", "com.amazon.shoptv.firetv.client", "com.amazon.tmm.tutorial",
        "com.amazon.storm.lightning.tutorial", "com.amazon.tv.releasenotes", "com.amazon.tv.earlyaccess",
        "com.amazon.minitv.android.app", "com.amazon.bueller.photos", "com.amazon.bueller.music",
        "com.amazon.gamehub", "com.amazon.tv.ftvambient", "com.amazon.tahoe", "com.amazon.cloud9",
        "com.amazon.tv.matter", "com.amazon.tv.mattercohost", "com.amazon.smarthomemapviewapp",
        // Updates
        "com.amazon.device.software.ota", "com.amazon.device.software.ota.override",
        "com.amazon.tv.forcedotaupdater.v2",
        // Alexa extras
        "com.amazon.vizzini", "com.amazon.alexamediaplayer.runtime.ftv", "com.amazon.alexa.externalmediaplayer.fireos",
        "com.amazon.tv.alexaalerts", "com.amazon.tv.alexanotifications",
        // Background services
        "com.amazon.ceviche", "com.amazon.systemnotices", "com.amazon.privacypassservice",
        "com.amazon.media.recommendations", "com.amazon.tv.website_launcher", "com.amazon.hedwig",
        "com.amazon.perfc", "com.amazon.logan", "com.amazon.neo.minerva.logcat", "com.amazon.connectivitydiag",
        "com.amazon.tigris", "com.amazon.tv.developer.dataservice", "com.amazon.ale",
        "com.amazon.device_remote_config_sync_service", "com.amazon.tv.easyupgrade",
        "com.amazon.dummy.alarmclock", "com.amazon.dummy.calendar", "com.amazon.dummy.contacts",
        "com.amazon.dummy.gallery", "com.amazon.dummy.music", "com.amazon.dummy.settings",
        "com.android.traceur", "com.amazon.spiderpork", "com.amazon.aca", "com.amazon.alexa.datastore.app",
        "com.amazon.whad", "com.amazon.alexadirectivebrokerservice",
        "com.amazon.firetv.androidskillconnectioncapability", "com.amazon.audiohome",
        "com.amazon.rtcsessioncontroller", "com.amazon.spotify.mediabrowserservice", "com.amazon.aria",
    ]
}
