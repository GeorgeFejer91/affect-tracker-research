/* Audited C ABI loader for flubber_bridge.dll. GPL-2.0-or-later. */
#ifndef VLC_FLUBBER_BRIDGE_HPP
#define VLC_FLUBBER_BRIDGE_HPP

#include <QCoreApplication>
#include <QDir>
#include <QLibrary>
#include <QByteArray>

class FlubberBridge
{
public:
    FlubberBridge()
        : library_( QDir( QCoreApplication::applicationDirPath() ).filePath( "flubber_bridge.dll" ) ),
          handle_( NULL ), update_( NULL ), interrupt_( NULL ), free_( NULL ), status_( NULL ), error_( NULL )
    {
        if( !library_.load() ) { startupError_ = library_.errorString(); return; }
        Create create = reinterpret_cast<Create>( library_.resolve( "flubber_bridge_new" ) );
        update_ = reinterpret_cast<Update>( library_.resolve( "flubber_bridge_update" ) );
        interrupt_ = reinterpret_cast<Interrupt>( library_.resolve( "flubber_bridge_interrupt" ) );
        free_ = reinterpret_cast<Free>( library_.resolve( "flubber_bridge_free" ) );
        status_ = reinterpret_cast<Status>( library_.resolve( "flubber_bridge_status" ) );
        error_ = reinterpret_cast<Error>( library_.resolve( "flubber_bridge_error" ) );
        if( create && update_ && interrupt_ && free_ && status_ && error_ ) handle_ = create();
        if( !handle_ )
        {
            startupError_ = library_.errorString();
            if( startupError_.isEmpty() ) startupError_ = QStringLiteral( "bridge initialization failed" );
            library_.unload();
        }
    }
    ~FlubberBridge()
    {
        /* Caller stops its GUI timer first. Rust joins its worker and closes
         * outlets/CSV before the DLL is unloaded. Never hold a VLC pointer. */
        if( handle_ ) free_( handle_ );
        if( library_.isLoaded() ) library_.unload();
    }
    bool ready() const { return handle_ != NULL; }
    int status() const { return handle_ ? status_( handle_ ) : -1; }
    QString error() const
    {
        if( !handle_ ) return startupError_;
        char buffer[512] = {};
        error_( handle_, buffer, sizeof( buffer ) );
        return QString::fromUtf8( buffer );
    }
    int update( float x, float y, int state, qint64 mediaMs,
                const QByteArray &name, const QByteArray &path )
    {
        if( !handle_ ) return -1;
        return update_( handle_, x, y, state, mediaMs, name.constData(), path.constData() );
    }
    int interrupt() { return handle_ ? interrupt_( handle_ ) : -1; }
private:
    typedef void *(*Create)();
    typedef int (*Update)(void *, float, float, int, qint64, const char *, const char *);
    typedef int (*Interrupt)(void *);
    typedef void (*Free)(void *);
    typedef int (*Status)(void *);
    typedef size_t (*Error)(void *, char *, size_t);
    QLibrary library_;
    void *handle_;
    Update update_;
    Interrupt interrupt_;
    Free free_;
    Status status_;
    Error error_;
    QString startupError_;
};

#endif
