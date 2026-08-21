package io.blurrycontour.activitylens;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * The two decisions {@link IncomingFiles} makes about a name it was handed by
 * another app. Both are pure, so they run on the host with no device.
 *
 * Worth pinning because the input is not ours: the name arrives from whichever
 * app did the sharing, and one of these two decides what gets written to disk.
 */
public class IncomingFilesTest {

    @Test
    public void acceptsWorkoutFiles() {
        assertTrue(IncomingFiles.isWorkoutFile("morning-run.gpx"));
        assertTrue(IncomingFiles.isWorkoutFile("ride.tcx"));
        assertTrue(IncomingFiles.isWorkoutFile("export.zip"));
        assertTrue(IncomingFiles.isWorkoutFile("activity.gpx.gz"));
        // What a watch actually records, and what its companion app shares.
        assertTrue(IncomingFiles.isWorkoutFile("2026-04-12-063000.fit"));
    }

    @Test
    public void extensionMatchIsCaseInsensitive() {
        // Exporters are inconsistent about this, and Android does not normalise.
        assertTrue(IncomingFiles.isWorkoutFile("RUN.GPX"));
        assertTrue(IncomingFiles.isWorkoutFile("Ride.Tcx"));
        assertTrue(IncomingFiles.isWorkoutFile("ACTIVITY.FIT"));
    }

    @Test
    public void rejectsEverythingElse() {
        assertFalse(IncomingFiles.isWorkoutFile("photo.jpg"));
        assertFalse(IncomingFiles.isWorkoutFile("notes.txt"));
        // The extension has to end the name, not merely appear in it.
        assertFalse(IncomingFiles.isWorkoutFile("gpx"));
        assertFalse(IncomingFiles.isWorkoutFile("run.gpx.exe"));
        assertFalse(IncomingFiles.isWorkoutFile(""));
        assertFalse(IncomingFiles.isWorkoutFile(null));
    }

    @Test
    public void safeNameKeepsOrdinaryNamesRecognisable() {
        assertEquals("morning-run.gpx", IncomingFiles.safeName("morning-run.gpx"));
        assertEquals("2024.03.01_ride.tcx", IncomingFiles.safeName("2024.03.01_ride.tcx"));
    }

    @Test
    public void safeNameCannotEscapeTheCacheDirectory() {
        // The result is joined onto the cache directory, so a separator or a
        // parent reference surviving here would write outside it.
        // Separators become underscores, then the leading dots go — which eats
        // the first `..` along with them.
        String climbed = IncomingFiles.safeName("../../../etc/passwd.gpx");
        assertFalse(climbed.contains("/"));
        assertFalse(climbed.startsWith("."));
        assertEquals("_.._.._etc_passwd.gpx", climbed);

        assertFalse(IncomingFiles.safeName("/absolute/path.gpx").contains("/"));
        assertFalse(IncomingFiles.safeName("..").startsWith("."));
    }

    @Test
    public void safeNameNeverReturnsEmptyOrHidden() {
        // A name that is entirely stripped still has to name a file.
        assertEquals("workout", IncomingFiles.safeName(""));
        assertEquals("workout", IncomingFiles.safeName("..."));
        assertEquals("workout", IncomingFiles.safeName(null));
        assertFalse(IncomingFiles.safeName(".hidden.gpx").startsWith("."));
    }

    @Test
    public void safeNameTruncatesFromTheFrontSoTheExtensionSurvives() {
        StringBuilder long_ = new StringBuilder();
        for (int i = 0; i < 200; i++) {
            long_.append('a');
        }
        String name = IncomingFiles.safeName(long_ + ".gpx");
        assertTrue(name.length() <= 96);
        assertTrue(name.endsWith(".gpx"));
    }
}
