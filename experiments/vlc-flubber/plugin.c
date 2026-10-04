/* Experimental native VLC 3.0 filter, separate from Planner and Runner. */
#ifdef _MSC_VER
#include <BaseTsd.h>
typedef SSIZE_T ssize_t;
#endif
#include <vlc_common.h>
#include <vlc_plugin.h>
#include <vlc_filter.h>
#include <vlc_interface.h>
#include <vlc_picture.h>
#include <vlc_variables.h>
#include <vlc_actions.h>
#include <lsl_c.h>
#include <windows.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define PREFIX "flubber-"
#define N 192
#define WAVES 16
#define LSL_BUFFER 1024
#define PI 3.14159265358979323846

typedef struct {
    HMODULE library;
    lsl_streaminfo affect_info, marker_info;
    lsl_outlet affect_outlet, marker_outlet;
    lsl_streaminfo (__cdecl *create_info)(const char *, const char *, int32_t,
                                          double, lsl_channel_format_t, const char *);
    void (__cdecl *destroy_info)(lsl_streaminfo);
    lsl_outlet (__cdecl *create_outlet)(lsl_streaminfo, int32_t, int32_t);
    void (__cdecl *destroy_outlet)(lsl_outlet);
    int32_t (__cdecl *push_float_at)(lsl_outlet, const float *, double);
    int32_t (__cdecl *push_string)(lsl_outlet, const char **);
    int32_t (__cdecl *push_string_at)(lsl_outlet, const char **, double);
    int32_t (__cdecl *have_consumers)(lsl_outlet);
    double (__cdecl *local_clock)(void);
} lsl_api_t;

typedef struct { double stamp; float x, y; } lsl_pending_t;
typedef struct { volatile LONG sequence, action, applied; } control_t;

static lsl_api_t outlet_lsl;
static SRWLOCK outlet_lock = SRWLOCK_INIT;
static bool outlet_ready;
static LONG outlet_users;

typedef struct {
    CRITICAL_SECTION lock;
    FILE *csv;
    char *csv_path;
    char *start_marker, *stop_marker;
    HANDLE control_handle;
    control_t *control;
    int panel_percent, step_percent, render_fps, width, video_height, total_height;
    double x, y, phase, pointy[N], rounded[N], phase_offset[WAVES], size_offset[WAVES];
    uint64_t frame_count;
    uint64_t blank_run;
    int64_t video_ms;
    bool started, ended, sentinel;
    bool replay_start_marker;
    double lsl_start_stamp;
    lsl_pending_t pending[LSL_BUFFER];
    size_t pending_count;
    size_t pending_dropped;
    lsl_api_t lsl;
    bool shared_lsl;
} flubber_t;

static int Open(vlc_object_t *);
static void Close(vlc_object_t *);
static picture_t *Render(filter_t *, picture_t *);
static int KeyEvent(vlc_object_t *, const char *, vlc_value_t, vlc_value_t, void *);
static int OutletOpen(vlc_object_t *);
static void OutletClose(vlc_object_t *);
static const char *const options[] = { "panel-percent", "video-height", "step-percent", "render-fps", "csv", "marker-base", "control-name", "lsl", "sentinel", NULL };

vlc_module_begin()
    set_shortname("Flubber")
    set_description("Native affect Flubber below video")
    set_capability("video filter", 0)
    set_category(CAT_VIDEO)
    set_subcategory(SUBCAT_VIDEO_VFILTER)
    add_integer_with_range(PREFIX "panel-percent", 25, 10, 100,
        "Flubber panel height", "Percent of the video height", false)
    add_integer_with_range(PREFIX "video-height", 0, 0, 8192,
        "Original video height", "Video height before FFmpeg bottom padding", false)
    add_integer_with_range(PREFIX "step-percent", 10, 1, 100,
        "Affect key step", "Arrow-key affect step in percent", false)
    add_integer_with_range(PREFIX "render-fps", 60, 1, 240,
        "Converted frame rate", "Constant frame rate of the padded video", false)
    add_savefile(PREFIX "csv", "", "Affect CSV path", "CSV output path", false)
    add_string(PREFIX "marker-base", "video", "Marker video name", "Original video filename for LSL Start/Stop markers", false)
    add_string(PREFIX "control-name", "", "Affect control channel", "Private Windows mapping name for Flubber commands", false)
    add_bool(PREFIX "lsl", false, "LSL output", "Send affect and start/end markers", false)
    add_bool(PREFIX "sentinel", false, "Prepared-media boundary signal", "Start data when the reserved panel indicates original video", false)
    set_callbacks(Open, Close)
    add_submodule()
    set_shortname("Flubber outlets")
    set_description("Persistent VLC Flubber LSL outlets")
    set_capability("interface", 0)
    add_shortcut("flubberoutlet")
    set_callbacks(OutletOpen, OutletClose)
vlc_module_end()

static double clip(double x, double lo, double hi)
{
    return x < lo ? lo : (x > hi ? hi : x);
}

static void normalize(double *a)
{
    double lo = a[0], hi = a[0];
    for (int i = 1; i < N; ++i) {
        if (a[i] < lo) lo = a[i];
        if (a[i] > hi) hi = a[i];
    }
    double span = hi > lo ? hi - lo : 1;
    for (int i = 0; i < N; ++i) a[i] = (a[i] - lo) / span;
}

/* Circle-base form of the 192-vertex, 16-wave profiles in site/src/math.js. */
static void init_profiles(flubber_t *s)
{
    for (int i = 0; i < N; ++i) {
        double theta = i * 2.0 * PI / N;
        int distance = abs(i % (N / WAVES) - (N / WAVES) / 2);
        s->rounded[i] = cos(WAVES * theta);
        s->pointy[i] = sin(3.0 * PI / 4.0) /
            sin(PI / 4.0 - 2.0 * PI * distance / N);
    }
    normalize(s->rounded);
    normalize(s->pointy);
    for (int i = 0; i < WAVES; ++i) {
        s->phase_offset[i] = PI * sin(12.9898 * (i + 1));
        s->size_offset[i] = sin(78.233 * (i + 1));
    }
}

static void row(flubber_t *s, const char *event)
{
    if (s->csv) {
        fprintf(s->csv, "%s,%lld,%.6f,%.6f,%.6f\n", event,
                (long long)s->video_ms, s->x, s->y, s->phase);
        fflush(s->csv);
    }
    if (s->lsl.library) {
        if (strcmp(event, "sample") == 0) {
            const float sample[2] = {(float)s->x, (float)s->y};
            double stamp = s->lsl.local_clock();
            if (s->lsl.have_consumers(s->lsl.affect_outlet)) {
                for (size_t i = 0; i < s->pending_count; ++i) {
                    const float old[2] = {s->pending[i].x, s->pending[i].y};
                    s->lsl.push_float_at(s->lsl.affect_outlet, old, s->pending[i].stamp);
                }
                s->pending_count = 0;
                s->lsl.push_float_at(s->lsl.affect_outlet, sample, stamp);
            } else {
                if (s->pending_count == LSL_BUFFER) {
                    memmove(s->pending, s->pending + 1,
                            (LSL_BUFFER - 1) * sizeof(s->pending[0]));
                    s->pending_count--;
                    s->pending_dropped++;
                }
                s->pending[s->pending_count++] =
                    (lsl_pending_t){stamp, sample[0], sample[1]};
            }
        } else if (strcmp(event, "video_start") == 0) {
            s->lsl_start_stamp = s->lsl.local_clock();
            s->replay_start_marker = !s->lsl.have_consumers(s->lsl.marker_outlet);
            if (!s->replay_start_marker) {
                const char *label = s->start_marker;
                s->lsl.push_string_at(s->lsl.marker_outlet, &label, s->lsl_start_stamp);
            }
        } else if (strcmp(event, "video_end") == 0) {
            const char *label = s->stop_marker;
            s->lsl.push_string(s->lsl.marker_outlet, &label);
        }
    }
}

static void close_lsl(lsl_api_t *a)
{
    if (a->destroy_outlet) {
        if (a->affect_outlet) a->destroy_outlet(a->affect_outlet);
        if (a->marker_outlet) a->destroy_outlet(a->marker_outlet);
    }
    if (a->destroy_info) {
        if (a->affect_info) a->destroy_info(a->affect_info);
        if (a->marker_info) a->destroy_info(a->marker_info);
    }
    if (a->library) FreeLibrary(a->library);
    memset(a, 0, sizeof(*a));
}

static bool open_lsl(lsl_api_t *a)
{
    const char *path = getenv("FLUBBER_LSL_DLL");
    if (!path || !path[0]) return false;
    a->library = LoadLibraryA(path);
    if (!a->library) return false;
#define LOAD(member, symbol) \
    a->member = (void *)GetProcAddress(a->library, symbol); \
    if (!a->member) { close_lsl(a); return false; }
    LOAD(create_info, "lsl_create_streaminfo")
    LOAD(destroy_info, "lsl_destroy_streaminfo")
    LOAD(create_outlet, "lsl_create_outlet")
    LOAD(destroy_outlet, "lsl_destroy_outlet")
    LOAD(push_float_at, "lsl_push_sample_ft")
    LOAD(push_string, "lsl_push_sample_str")
    LOAD(push_string_at, "lsl_push_sample_strt")
    LOAD(have_consumers, "lsl_have_consumers")
    LOAD(local_clock, "lsl_local_clock")
#undef LOAD
    char affect_source[80], marker_source[80];
    snprintf(affect_source, sizeof(affect_source), "vlc-flubber-%lu-affect",
             (unsigned long)GetCurrentProcessId());
    snprintf(marker_source, sizeof(marker_source), "vlc-flubber-%lu-markers",
             (unsigned long)GetCurrentProcessId());
    a->affect_info = a->create_info("VLC_Flubber_Affect", "Affect", 2, 0.0,
                                   cft_float32, affect_source);
    a->marker_info = a->create_info("VLC_Flubber_Markers", "Markers", 1, 0.0,
                                   cft_string, marker_source);
    if (!a->affect_info || !a->marker_info) { close_lsl(a); return false; }
    a->affect_outlet = a->create_outlet(a->affect_info, 0, 360);
    a->marker_outlet = a->create_outlet(a->marker_info, 0, 360);
    if (!a->affect_outlet || !a->marker_outlet) { close_lsl(a); return false; }
    return true;
}

static int OutletOpen(vlc_object_t *object)
{
    (void)object;
    AcquireSRWLockExclusive(&outlet_lock);
    if (!outlet_ready && !open_lsl(&outlet_lsl)) {
        ReleaseSRWLockExclusive(&outlet_lock);
        return VLC_EGENERIC;
    }
    outlet_ready = true;
    ReleaseSRWLockExclusive(&outlet_lock);
    return VLC_SUCCESS;
}

static void OutletClose(vlc_object_t *object)
{
    (void)object;
    AcquireSRWLockExclusive(&outlet_lock);
    outlet_ready = false;
    ReleaseSRWLockExclusive(&outlet_lock);
    for (int i = 0; i < 300 && InterlockedCompareExchange(&outlet_users, 0, 0); ++i)
        Sleep(10);
    AcquireSRWLockExclusive(&outlet_lock);
    if (!InterlockedCompareExchange(&outlet_users, 0, 0))
        close_lsl(&outlet_lsl);
    ReleaseSRWLockExclusive(&outlet_lock);
}

/* VLC's official Windows build allocates returned strings with msvcrt.dll;
 * this MSVC-built probe uses UCRT. Keep allocation ownership explicit. */
static void free_vlc_string(char *value)
{
    if (!value) return;
    HMODULE crt = GetModuleHandleA("msvcrt.dll");
    void (__cdecl *release)(void *) = crt ?
        (void (__cdecl *)(void *))GetProcAddress(crt, "free") : NULL;
    if (release) release(value);
}

static int Open(vlc_object_t *object)
{
    filter_t *f = (filter_t *)object;
    if (f->fmt_in.video.i_chroma != VLC_CODEC_I420 ||
        f->fmt_out.video.i_chroma != VLC_CODEC_I420) {
        msg_Err(f, "Flubber requires an I420 padded video");
        return VLC_EGENERIC;
    }
    int width = (int)f->fmt_in.video.i_visible_width;
    int total_height = (int)f->fmt_in.video.i_visible_height;
    if (width < 64 || total_height < 68 || (width & 1) || (total_height & 1))
        return VLC_EGENERIC;
    config_ChainParse(f, PREFIX, options, f->p_cfg);
    int percent = (int)clip(var_CreateGetInteger(f, PREFIX "panel-percent"), 10, 100);
    int height = (int)var_CreateGetInteger(f, PREFIX "video-height");
    int step = (int)clip(var_CreateGetInteger(f, PREFIX "step-percent"), 1, 100);
    int render_fps = (int)clip(var_CreateGetInteger(f, PREFIX "render-fps"), 1, 240);
    if (height == 0) height = (total_height * 100 / (100 + percent)) & ~1;
    int panel = total_height - height;
    if (height < 64 || (height & 1) || panel < 4 ||
        abs(panel * 100 - height * percent) > 200) {
        msg_Err(f, "Padded video height does not match Flubber ratio");
        return VLC_EGENERIC;
    }

    flubber_t *s = calloc(1, sizeof(*s));
    if (!s) return VLC_ENOMEM;
    InitializeCriticalSection(&s->lock);
    s->panel_percent = percent;
    s->step_percent = step;
    s->render_fps = render_fps;
    s->sentinel = var_CreateGetBool(f, PREFIX "sentinel");
    s->width = width;
    s->video_height = height;
    s->total_height = total_height;
    s->csv_path = var_CreateGetString(f, PREFIX "csv");
    char *marker_base = var_CreateGetString(f, PREFIX "marker-base");
    if (!marker_base || !marker_base[0] || strlen(marker_base) > 900) {
        free_vlc_string(marker_base);
        free_vlc_string(s->csv_path);
        DeleteCriticalSection(&s->lock);
        free(s);
        return VLC_EGENERIC;
    }
    size_t marker_size = strlen(marker_base) + sizeof("_Start");
    s->start_marker = malloc(marker_size);
    s->stop_marker = malloc(marker_size);
    if (!s->start_marker || !s->stop_marker) {
        free(s->start_marker);
        free(s->stop_marker);
        free_vlc_string(marker_base);
        free_vlc_string(s->csv_path);
        DeleteCriticalSection(&s->lock);
        free(s);
        return VLC_ENOMEM;
    }
    snprintf(s->start_marker, marker_size, "%s_Start", marker_base);
    snprintf(s->stop_marker, marker_size, "%s_Stop", marker_base);
    free_vlc_string(marker_base);
    char *control_name = var_CreateGetString(f, PREFIX "control-name");
    if (control_name && control_name[0]) {
        s->control_handle = CreateFileMappingA(INVALID_HANDLE_VALUE, NULL,
                                               PAGE_READWRITE, 0,
                                               sizeof(control_t), control_name);
        if (s->control_handle && GetLastError() == ERROR_ALREADY_EXISTS) {
            CloseHandle(s->control_handle);
            s->control_handle = NULL;
        }
        if (s->control_handle)
            s->control = MapViewOfFile(s->control_handle, FILE_MAP_ALL_ACCESS,
                                       0, 0, sizeof(control_t));
        if (!s->control) {
            if (s->control_handle) CloseHandle(s->control_handle);
            free_vlc_string(control_name);
            free(s->start_marker);
            free(s->stop_marker);
            free_vlc_string(s->csv_path);
            DeleteCriticalSection(&s->lock);
            free(s);
            return VLC_EGENERIC;
        }
    }
    free_vlc_string(control_name);
    if (s->csv_path && s->csv_path[0]) {
        if (fopen_s(&s->csv, s->csv_path, "w") != 0) {
            msg_Err(f, "Cannot open CSV: %s", s->csv_path);
            free_vlc_string(s->csv_path);
            if (s->control) UnmapViewOfFile(s->control);
            if (s->control_handle) CloseHandle(s->control_handle);
            free(s->start_marker);
            free(s->stop_marker);
            DeleteCriticalSection(&s->lock);
            free(s);
            return VLC_EGENERIC;
        }
        fputs("event,video_ms,valence,arousal,phase_rad\n", s->csv);
        fflush(s->csv);
    }
    if (var_CreateGetBool(f, PREFIX "lsl")) {
        AcquireSRWLockExclusive(&outlet_lock);
        if (outlet_ready) {
            InterlockedIncrement(&outlet_users);
            s->lsl = outlet_lsl;
            s->shared_lsl = true;
        }
        ReleaseSRWLockExclusive(&outlet_lock);
        if (!s->shared_lsl && !open_lsl(&s->lsl)) {
            msg_Err(f, "LSL requested but the pinned FLUBBER_LSL_DLL could not start");
            if (s->csv) fclose(s->csv);
            free_vlc_string(s->csv_path);
            if (s->control) UnmapViewOfFile(s->control);
            if (s->control_handle) CloseHandle(s->control_handle);
            free(s->start_marker);
            free(s->stop_marker);
            DeleteCriticalSection(&s->lock);
            free(s);
            return VLC_EGENERIC;
        }
    }
    init_profiles(s);
    f->p_sys = (filter_sys_t *)s;
    f->pf_video_filter = Render;
    var_AddCallback(f->obj.libvlc, "key-pressed", KeyEvent, f);
    msg_Info(f, "Flubber ready: %dx%d video, %dpx panel", width, height, panel);
    return VLC_SUCCESS;
}

static void Close(vlc_object_t *object)
{
    filter_t *f = (filter_t *)object;
    flubber_t *s = (flubber_t *)f->p_sys;
    var_DelCallback(f->obj.libvlc, "key-pressed", KeyEvent, f);
    EnterCriticalSection(&s->lock);
    if (s->started && !s->ended) row(s, "video_end");
    if (s->pending_dropped)
        msg_Warn(f, "%llu early LSL samples exceeded the receiver buffer",
                 (unsigned long long)s->pending_dropped);
    if (s->csv) fclose(s->csv);
    if (s->shared_lsl) InterlockedDecrement(&outlet_users);
    else close_lsl(&s->lsl);
    LeaveCriticalSection(&s->lock);
    DeleteCriticalSection(&s->lock);
    free_vlc_string(s->csv_path);
    if (s->control) UnmapViewOfFile(s->control);
    if (s->control_handle) CloseHandle(s->control_handle);
    free(s->start_marker);
    free(s->stop_marker);
    free(s);
}

static int KeyEvent(vlc_object_t *object, const char *name,
                    vlc_value_t previous, vlc_value_t current, void *opaque)
{
    (void)object; (void)previous;
    flubber_t *s = (flubber_t *)((filter_t *)opaque)->p_sys;
    double step = s->step_percent / 100.0;
    const char *event = NULL;
    (void)name;
    EnterCriticalSection(&s->lock);
    switch (current.i_int) {
        case KEY_LEFT:  s->x = clip(s->x - step, -1, 1); event = "left"; break;
        case KEY_RIGHT: s->x = clip(s->x + step, -1, 1); event = "right"; break;
        case KEY_UP:    s->y = clip(s->y + step, -1, 1); event = "up"; break;
        case KEY_DOWN:  s->y = clip(s->y - step, -1, 1); event = "down"; break;
    }
    if (event && s->started) row(s, event);
    LeaveCriticalSection(&s->lock);
    return VLC_SUCCESS;
}

static void yuv_color(double x, double y, uint8_t *l, uint8_t *u, uint8_t *v)
{
    const int anchor[4][3] = {
        {255, 91, 104}, {93, 255, 176}, {255, 209, 102}, {92, 124, 250}
    };
    double weight[4] = { fmax(0, -x), fmax(0, x), fmax(0, y), fmax(0, -y) };
    double total = weight[0] + weight[1] + weight[2] + weight[3];
    double saturation = clip(hypot(x, y), 0, 1);
    int rgb[3];
    for (int c = 0; c < 3; ++c) {
        double directional = 183;
        if (total > 0.000001) {
            directional = 0;
            for (int i = 0; i < 4; ++i) directional += weight[i] * anchor[i][c] / total;
        }
        rgb[c] = (int)floor(183 + saturation * (directional - 183) + 0.5);
    }
    *l = (uint8_t)clip(16 + ((66*rgb[0] + 129*rgb[1] + 25*rgb[2] + 128) >> 8), 0, 255);
    *u = (uint8_t)clip(128 + ((-38*rgb[0] - 74*rgb[1] + 112*rgb[2] + 128) >> 8), 0, 255);
    *v = (uint8_t)clip(128 + ((112*rgb[0] - 94*rgb[1] - 18*rgb[2] + 128) >> 8), 0, 255);
}

static void pixel(picture_t *p, int x, int y, uint8_t l, uint8_t u, uint8_t v)
{
    if (x < 0 || y < 0 || x >= (int)p->format.i_visible_width ||
        y >= (int)p->format.i_visible_height) return;
    p->p[0].p_pixels[y * p->p[0].i_pitch + x] = l;
    p->p[1].p_pixels[(y/2) * p->p[1].i_pitch + x/2] = u;
    p->p[2].p_pixels[(y/2) * p->p[2].i_pitch + x/2] = v;
}

static void outline(picture_t *p, int x0, int y0, int x1, int y1,
                    uint8_t l, uint8_t u, uint8_t v)
{
    int dx = abs(x1-x0), sx = x0 < x1 ? 1 : -1;
    int dy = -abs(y1-y0), sy = y0 < y1 ? 1 : -1;
    int err = dx + dy;
    for (;;) {
        pixel(p, x0, y0, l, u, v);
        pixel(p, x0+1, y0, l, u, v);
        if (x0 == x1 && y0 == y1) break;
        int twice = 2*err;
        if (twice >= dy) { err += dy; x0 += sx; }
        if (twice <= dx) { err += dx; y0 += sy; }
    }
}

static void draw_flubber(picture_t *p, flubber_t *s)
{
    int panel = s->total_height - s->video_height;
    double radius = fmin(s->width * 0.15, panel * 0.38);
    double cx = s->width/2.0, cy = s->video_height + panel/2.0;
    double mix = (s->x+1.0)/2.0, amplitude = 0.3+0.1*s->y;
    double disorder = 0.4*(1.0-s->x);
    double scale = 0.9+0.1*(0.5+0.5*sin(s->phase));
    int px[N], py[N];
    uint8_t l,u,v;
    yuv_color(s->x, s->y, &l, &u, &v);
    for (int i=0; i<N; ++i) {
        int wave_index = ((i+N/WAVES/2)/(N/WAVES))%WAVES;
        double theta = i*2.0*PI/N;
        double shape = (1.0-mix)*s->pointy[i]+mix*s->rounded[i];
        double wave = 0.5+0.5*sin(s->phase+disorder*s->phase_offset[wave_index]);
        double asymmetry = 1.0+disorder*s->size_offset[wave_index];
        double r = radius*(1.0+shape*amplitude*wave*asymmetry)*scale;
        px[i] = (int)floor(cx+r*cos(theta)+0.5);
        py[i] = (int)floor(cy+r*sin(theta)+0.5);
    }
    for (int y=s->video_height; y<s->total_height; ++y) {
        double crossings[N]; int count=0;
        for (int i=0; i<N; ++i) {
            int j=(i+1)%N;
            if ((py[i]<=y && py[j]>y) || (py[j]<=y && py[i]>y))
                crossings[count++] = px[i]+(double)(y-py[i])*(px[j]-px[i])/(py[j]-py[i]);
        }
        for (int i=1; i<count; ++i) {
            double value=crossings[i]; int j=i-1;
            while (j>=0 && crossings[j]>value) { crossings[j+1]=crossings[j]; --j; }
            crossings[j+1]=value;
        }
        for (int i=0; i+1<count; i+=2) {
            int left=(int)ceil(crossings[i]), right=(int)floor(crossings[i+1]);
            if (left<0) left=0;
            if (right>=s->width) right=s->width-1;
            for (int x=left; x<=right; ++x) pixel(p,x,y,l,u,v);
        }
    }
    for (int i=0; i<N; ++i) {
        int j=(i+1)%N;
        outline(p,px[i],py[i],px[j],py[j],235,u,v);
    }
}

static picture_t *Render(filter_t *f, picture_t *source)
{
    if (!source) return NULL;
    flubber_t *s=(flubber_t *)f->p_sys;
    picture_t *out=filter_NewPicture(f);
    if (!out) { picture_Release(source); return NULL; }
    if (source->i_planes!=3 || out->i_planes!=3) goto failed;
    for (int plane=0; plane<3; ++plane) {
        int rows=s->video_height/(plane==0?1:2);
        int cols=source->p[plane].i_visible_pitch;
        if (rows>out->p[plane].i_visible_lines ||
            cols>out->p[plane].i_visible_pitch) goto failed;
        for (int y=0; y<rows; ++y)
            memcpy(out->p[plane].p_pixels+y*out->p[plane].i_pitch,
                   source->p[plane].p_pixels+y*source->p[plane].i_pitch,cols);
        for (int y=rows; y<out->p[plane].i_visible_lines; ++y)
            memset(out->p[plane].p_pixels+y*out->p[plane].i_pitch,
                   plane==0?16:128,out->p[plane].i_visible_pitch);
    }
    EnterCriticalSection(&s->lock);
    if (s->control) {
        LONG next = InterlockedCompareExchange(&s->control->sequence, 0, 0);
        if (next != InterlockedCompareExchange(&s->control->applied, 0, 0)) {
            LONG action = InterlockedCompareExchange(&s->control->action, 0, 0);
            double step = s->step_percent / 100.0;
            const char *event = NULL;
            switch (action) {
                case 1: s->x = clip(s->x - step, -1, 1); event = "left"; break;
                case 2: s->x = clip(s->x + step, -1, 1); event = "right"; break;
                case 3: s->y = clip(s->y + step, -1, 1); event = "up"; break;
                case 4: s->y = clip(s->y - step, -1, 1); event = "down"; break;
            }
            if (event && s->started && !s->ended) row(s, event);
            InterlockedExchange(&s->control->applied, next);
        }
    }
    bool content = !s->sentinel ||
        source->p[0].p_pixels[s->video_height * source->p[0].i_pitch] > 180;
    if (s->sentinel && !content && s->started && !s->ended)
        s->blank_run++;
    if (s->sentinel && content && s->blank_run && !s->ended) {
        s->blank_run = 0;
    }
    if (s->sentinel && s->blank_run >= 8 && s->started && !s->ended) {
        row(s, "video_end");
        s->ended = true;
    }
    if (s->ended || (s->sentinel && !content)) {
        LeaveCriticalSection(&s->lock);
        picture_CopyProperties(out,source);
        picture_Release(source);
        return out;
    }
    if (!s->started) {
        s->started=true;
        s->frame_count=0;
        s->video_ms=0;
        row(s,"video_start");
    } else {
        s->phase=fmod(s->phase+2.0*PI*(1.5+s->y)/s->render_fps,2.0*PI);
    }
    s->video_ms=(int64_t)((s->frame_count*1000 + s->render_fps/2)/s->render_fps);
    if (s->lsl.library && s->replay_start_marker &&
        s->lsl.have_consumers(s->lsl.marker_outlet)) {
        const char *label = s->start_marker;
        s->lsl.push_string_at(s->lsl.marker_outlet, &label, s->lsl_start_stamp);
        s->replay_start_marker = false;
    }
    draw_flubber(out,s);
    row(s,"sample");
    s->frame_count++;
    LeaveCriticalSection(&s->lock);
    picture_CopyProperties(out,source);
    picture_Release(source);
    return out;
failed:
    picture_Release(source);
    picture_Release(out);
    return NULL;
}
