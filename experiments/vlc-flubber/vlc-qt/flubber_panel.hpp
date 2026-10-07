/* Flubber extension for VLC 3.0.20 Qt. GPL-2.0-or-later, as the host module. */
#ifndef VLC_FLUBBER_PANEL_HPP
#define VLC_FLUBBER_PANEL_HPP

#include <QWidget>
#include <QTimer>
#include <QElapsedTimer>
#include <QPainter>
#include <QPainterPath>
#include <QMouseEvent>
#include <QKeyEvent>
#include <QApplication>
#include <QCursor>
#include <QEvent>
#include <QJsonDocument>
#include <QJsonObject>
#include <QJsonArray>
#include <QFile>
#include <QFileDialog>
#include <QDialog>
#include <QDialogButtonBox>
#include <QFormLayout>
#include <QVBoxLayout>
#include <QLabel>
#include <QPushButton>
#include <QSpinBox>
#include <QSettings>
#include <QMessageBox>
#include <QSet>
#include <QVector>
#include <QFileInfo>
#include <QSizePolicy>
#include <QtMath>
#include <cstdint>
#include <cmath>
#include <functional>
#ifdef Q_OS_WIN
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#endif

/* The Planner's vlc-flubber-appearance/v1 contract is deliberately closed.
 * Parse into a temporary object and change the live preset only after every
 * field has passed validation. Position and size are player-owned settings. */
class FlubberPanel : public QWidget
{
public:
    explicit FlubberPanel( QSettings *settings, QWidget *parent = NULL )
        : QWidget( parent ), settings_( settings ), affectX_( 0 ), affectY_( 0 ),
          phase_( 0 ), sizePercent_( 65 ), xPercent_( 50 ), yPercent_( 50 ),
          panelHeight_( 130 ), panelPercent_( -1 ), stepPercent_( 10 ), referenceSurface_( NULL ),
          ratingActive_( false ), capturePending_( false ), cursorHideCalls_( 0 )
    {
        setObjectName( "vlc-flubber-panel" );
        setMouseTracking( true );
        setFocusPolicy( Qt::ClickFocus );
        setToolTip( QObject::tr( "Click to rate with relative mouse movement; Escape releases the pointer." ) );
        setAutoFillBackground( true );
        QPalette p = palette();
        p.setColor( QPalette::Window, Qt::black );
        setPalette( p );
        setSizePolicy( QSizePolicy::Expanding, QSizePolicy::Fixed );
        sizePercent_ = qBound( 10, settings_->value( "Flubber/sizePercent", 65 ).toInt(), 100 );
        xPercent_ = qBound( 0, settings_->value( "Flubber/xPercent", 50 ).toInt(), 100 );
        yPercent_ = qBound( 0, settings_->value( "Flubber/yPercent", 50 ).toInt(), 100 );
        panelHeight_ = qBound( 48, settings_->value( "Flubber/panelHeight", 130 ).toInt(), 2160 );
        bool parsed = false;
        const int requestedPanel = qEnvironmentVariableIntValue( "VLC_FLUBBER_PANEL_PERCENT", &parsed );
        if( parsed && requestedPanel >= 10 && requestedPanel <= 100 ) panelPercent_ = requestedPanel;
        const int requestedStep = qEnvironmentVariableIntValue( "VLC_FLUBBER_STEP_PERCENT", &parsed );
        if( parsed && requestedStep >= 1 && requestedStep <= 100 ) stepPercent_ = requestedStep;
        setFixedHeight( panelHeight_ );
        initializeShape();
        preset_ = defaultPreset();
        const QString path = settings_->value( "Flubber/appearancePath" ).toString();
        if( !path.isEmpty() )
        {
            QString error;
            QJsonObject loaded;
            if( readAppearance( path, loaded, error ) ) preset_ = loaded;
            else appearanceLoadError_ = error;
        }
        clock_.start();
        qApp->installEventFilter( this );
        QTimer *timer = new QTimer( this );
        timer->setTimerType( Qt::PreciseTimer );
        connect( timer, &QTimer::timeout, this, [this]() {
            if( ratingActive_ && ( !ratingWindowIsForeground()
#ifdef Q_OS_WIN
                || GetCapture() != reinterpret_cast<HWND>( winId() )
#endif
                ) ) interruptRating();
            if( ratingActive_ && rateAllowed_ && !rateAllowed_() ) releaseRating();
            if( panelPercent_ > 0 && referenceSurface_ )
            {
                const int combined = referenceSurface_->height() + this->height();
                const int height = qBound( 48,
                    qRound( combined * panelPercent_ / ( 100.0 + panelPercent_ ) ), 2160 );
                if( height != this->height() ) setFixedHeight( height );
            }
            const qint64 elapsed = clock_.restart();
            const double frequency = mapped( "oscillationFrequency" );
            phase_ = std::fmod( phase_ + qMin<qint64>( elapsed, 100 ) * .001 * 2 * M_PI * frequency, 2 * M_PI );
            update();
        } );
        timer->start( 33 );
    }

    ~FlubberPanel() Q_DECL_OVERRIDE
    {
        releaseRating();
        qApp->removeEventFilter( this );
    }

    /* Call only on the Qt GUI thread. Other threads must use a queued call. */
    void setAffect( double valence, double arousal )
    {
        affectX_ = qBound( -1.0, valence, 1.0 );
        affectY_ = qBound( -1.0, arousal, 1.0 );
        update();
    }
    float valence() const { return float( affectX_ ); }
    float arousal() const { return float( affectY_ ); }
    QString appearanceLoadError() const { return appearanceLoadError_; }
    bool ratingActive() const { return ratingActive_; }
    void stopRating() { releaseRating(); }
    void setVideoAffect( double valence, double arousal )
    {
        if( !ratingActive_ ) setAffect( valence, arousal );
    }
    void setInterruptHandler( const std::function<void()> &handler ) { interrupted_ = handler; }
    void setRateAllowedHandler( const std::function<bool()> &handler ) { rateAllowed_ = handler; }
    void setReferenceSurface( QWidget *surface ) { referenceSurface_ = surface; }

    void showControls( QWidget *parent )
    {
        QDialog dialog( parent );
        dialog.setWindowTitle( QObject::tr( "Flubber Controls" ) );
        QJsonObject pendingPreset = preset_;
        QString pendingPath = settings_->value( "Flubber/appearancePath" ).toString();
        QVBoxLayout *layout = new QVBoxLayout( &dialog );
        QFormLayout *form = new QFormLayout;
        QSpinBox *height = spin( &dialog, 48, 2160, panelHeight_, QObject::tr( " px" ) );
        if( panelPercent_ > 0 )
        {
            height->setValue( this->height() );
            height->setEnabled( false );
            height->setToolTip( QObject::tr( "Panel height is controlled by this Recorder session." ) );
        }
        QSpinBox *size = spin( &dialog, 10, 100, sizePercent_, QObject::tr( " %" ) );
        QSpinBox *x = spin( &dialog, 0, 100, xPercent_, QObject::tr( " %" ) );
        QSpinBox *y = spin( &dialog, 0, 100, yPercent_, QObject::tr( " %" ) );
        form->addRow( QObject::tr( "Bottom panel height" ), height );
        form->addRow( QObject::tr( "Flubber size" ), size );
        form->addRow( QObject::tr( "Horizontal position" ), x );
        form->addRow( QObject::tr( "Vertical position" ), y );
        layout->addLayout( form );
        QLabel *current = new QLabel( &dialog );
        current->setWordWrap( true );
        current->setText( pendingPath.isEmpty()
                          ? QObject::tr( "Default Flubber appearance" )
                          : pendingPath );
        layout->addWidget( current );
        QPushButton *load = new QPushButton( QObject::tr( "Load appearance JSON…" ), &dialog );
        layout->addWidget( load );
        connect( load, &QPushButton::clicked, &dialog, [&dialog, current, &pendingPreset, &pendingPath]() {
            const QString path = QFileDialog::getOpenFileName( &dialog,
                QObject::tr( "Load Flubber appearance" ), QString(), QObject::tr( "JSON files (*.json)" ) );
            if( path.isEmpty() ) return;
            QJsonObject next;
            QString error;
            if( !readAppearance( path, next, error ) )
            {
                QMessageBox::warning( &dialog, QObject::tr( "Invalid Flubber appearance" ), error );
                return;
            }
            pendingPreset = next;
            pendingPath = QFileInfo( path ).absoluteFilePath();
            current->setText( path );
        } );
        QDialogButtonBox *buttons = new QDialogButtonBox( QDialogButtonBox::Ok | QDialogButtonBox::Cancel, &dialog );
        layout->addWidget( buttons );
        connect( buttons, &QDialogButtonBox::accepted, &dialog, &QDialog::accept );
        connect( buttons, &QDialogButtonBox::rejected, &dialog, &QDialog::reject );
        if( dialog.exec() == QDialog::Accepted )
        {
            preset_ = pendingPreset;
            settings_->setValue( "Flubber/appearancePath", pendingPath );
            if( panelPercent_ < 0 ) panelHeight_ = height->value();
            sizePercent_ = size->value();
            xPercent_ = x->value(); yPercent_ = y->value();
            if( panelPercent_ < 0 ) settings_->setValue( "Flubber/panelHeight", panelHeight_ );
            settings_->setValue( "Flubber/sizePercent", sizePercent_ );
            settings_->setValue( "Flubber/xPercent", xPercent_ );
            settings_->setValue( "Flubber/yPercent", yPercent_ );
            if( panelPercent_ < 0 ) setFixedHeight( panelHeight_ );
            update();
        }
    }

    static bool readAppearance( const QString &path, QJsonObject &out, QString &error )
    {
        QFile file( path );
        if( !file.open( QIODevice::ReadOnly ) ) { error = file.errorString(); return false; }
        if( file.size() > 65536 ) { error = QObject::tr( "Appearance JSON exceeds 64 KiB." ); return false; }
        const QByteArray bytes = file.readAll();
        QJsonParseError parse;
        QJsonDocument document = QJsonDocument::fromJson( bytes, &parse );
        if( parse.error != QJsonParseError::NoError || !document.isObject() )
        { error = QObject::tr( "Appearance JSON is not an object: %1" ).arg( parse.errorString() ); return false; }
        if( !uniqueKeys( bytes ) )
        { error = QObject::tr( "Appearance JSON contains a duplicate key." ); return false; }
        const QJsonObject root = document.object();
        if( !keys( root, { "schema", "visual", "presentation", "mappings" } ) ||
            root.value( "schema" ).toString() != QLatin1String( "vlc-flubber-appearance/v1" ) ||
            !root.value( "visual" ).isObject() || !root.value( "presentation" ).isObject() ||
            !root.value( "mappings" ).isObject() )
        { error = QObject::tr( "Unexpected appearance schema or top-level fields." ); return false; }
        const QJsonObject visual = root.value( "visual" ).toObject();
        const QJsonObject presentation = root.value( "presentation" ).toObject();
        const QJsonObject mappings = root.value( "mappings" ).toObject();
        if( !keys( visual, { "transparency", "flubber", "colors" } ) ||
            !number( visual.value( "transparency" ), 0, 1 ) ||
            !visual.value( "flubber" ).isObject() || !visual.value( "colors" ).isObject() ||
            !keys( presentation, { "colorAnchors", "halo" } ) ||
            !presentation.value( "halo" ).isObject() )
        { error = QObject::tr( "Invalid visual or presentation fields." ); return false; }
        const QJsonObject flubber = visual.value( "flubber" ).toObject();
        const QJsonObject colors = visual.value( "colors" ).toObject();
        const QJsonObject halo = presentation.value( "halo" ).toObject();
        if( !keys( flubber, { "showOutline", "outlineThickness", "showHalo" } ) ||
            !flubber.value( "showOutline" ).isBool() || !flubber.value( "showHalo" ).isBool() ||
            !number( flubber.value( "outlineThickness" ), 0, 20 ) ||
            !keys( colors, { "up", "down", "left", "right", "idle", "outline", "halo", "cursor" } ) ||
            !keys( halo, { "widthPercent", "gradient", "steepness" } ) ||
            !number( halo.value( "widthPercent" ), 0, 10000 ) ||
            !halo.value( "gradient" ).isBool() || !number( halo.value( "steepness" ), .1, 10 ) ||
            ( presentation.value( "colorAnchors" ).toString() != QLatin1String( "axes" ) &&
              presentation.value( "colorAnchors" ).toString() != QLatin1String( "corners" ) ) )
        { error = QObject::tr( "Invalid Flubber visual settings." ); return false; }
        for( QJsonObject::const_iterator it = colors.begin(); it != colors.end(); ++it )
        {
            const QString c = it.value().toString();
            if( c.size() != 7 || !c.startsWith( '#' ) )
            { error = QObject::tr( "Invalid color: %1" ).arg( it.key() ); return false; }
            for( int i = 1; i < 7; ++i )
                if( !QStringLiteral( "0123456789abcdefABCDEF" ).contains( c.at( i ) ) )
                { error = QObject::tr( "Invalid color: %1" ).arg( it.key() ); return false; }
        }
        const char *names[] = { "oscillationFrequency", "edgeSmoothness", "projectionAmplitude",
                                "pulseSynchrony", "waveSizeVariation", "saturation" };
        if( mappings.size() != 6 ) { error = QObject::tr( "Expected six Flubber mappings." ); return false; }
        for( int i = 0; i < 6; ++i )
        {
            const QString name = QLatin1String( names[i] );
            if( !mappings.value( name ).isObject() ) { error = QObject::tr( "Missing mapping: %1" ).arg( name ); return false; }
            const QJsonObject mapping = mappings.value( name ).toObject();
            const double maximum = i == 0 ? 10 : 1;
            const QString driver = mapping.value( "drivenBy" ).toString();
            if( !keys( mapping, { "min", "max", "drivenBy", "reverse" } ) ||
                !number( mapping.value( "min" ), 0, maximum ) || !number( mapping.value( "max" ), 0, maximum ) ||
                mapping.value( "min" ).toDouble() > mapping.value( "max" ).toDouble() ||
                ( driver != QLatin1String( "x-axis" ) && driver != QLatin1String( "y-axis" ) &&
                  driver != QLatin1String( "angle" ) && driver != QLatin1String( "radius" ) ) ||
                !mapping.value( "reverse" ).isBool() )
            { error = QObject::tr( "Invalid mapping: %1" ).arg( name ); return false; }
        }
        out = root;
        return true;
    }

protected:
    bool eventFilter( QObject *watched, QEvent *event ) Q_DECL_OVERRIDE
    {
        if( ratingActive_ && ( event->type() == QEvent::ApplicationDeactivate ||
            ( watched == window() && event->type() == QEvent::WindowDeactivate ) ) )
            interruptRating();
        if( ratingActive_ && watched == window() &&
            ( event->type() == QEvent::Resize || event->type() == QEvent::Move ) )
            releaseRating();
        return QWidget::eventFilter( watched, event );
    }
    void keyPressEvent( QKeyEvent *event ) Q_DECL_OVERRIDE
    {
        if( event->key() == Qt::Key_Escape && ratingActive_ )
        {
            releaseRating(); event->accept(); return;
        }
        if( !ratingActive_ ) { QWidget::keyPressEvent( event ); return; }
        const double step = stepPercent_ / 100.0;
        switch( event->key() )
        {
            case Qt::Key_Left: setAffect( affectX_ - step, affectY_ ); break;
            case Qt::Key_Right: setAffect( affectX_ + step, affectY_ ); break;
            case Qt::Key_Up: setAffect( affectX_, affectY_ + step ); break;
            case Qt::Key_Down: setAffect( affectX_, affectY_ - step ); break;
            default: QWidget::keyPressEvent( event ); return;
        }
        event->accept();
    }
    void mouseMoveEvent( QMouseEvent *event ) Q_DECL_OVERRIDE
    {
        if( ratingActive_ )
        {
            const QPoint center = mapToGlobal( rect().center() );
            const QPoint delta = event->globalPos() - center;
            if( !delta.isNull() )
            {
                const double travel = qMax( 1.0, window()->height() * .6 );
                setAffect( affectX_ + 2 * qBound( -150, delta.x(), 150 ) / travel,
                           affectY_ - 2 * qBound( -150, delta.y(), 150 ) / travel );
                QCursor::setPos( center );
            }
            event->accept();
            return;
        }
        setAffect( event->localPos().x() * 2 / qMax( 1, width() ) - 1,
                   1 - event->localPos().y() * 2 / qMax( 1, height() ) );
        QWidget::mouseMoveEvent( event );
    }
    void mousePressEvent( QMouseEvent *event ) Q_DECL_OVERRIDE
    {
        if( event->button() == Qt::LeftButton && !ratingActive_ )
        {
            capturePending_ = true;
            event->accept();
            return;
        }
        QWidget::mousePressEvent( event );
    }
    void mouseReleaseEvent( QMouseEvent *event ) Q_DECL_OVERRIDE
    {
        if( event->button() == Qt::LeftButton && capturePending_ )
        {
            capturePending_ = false;
            /* Qt releases its own implicit button capture after this event.
             * Install our explicit rating capture on the next GUI turn. */
            QTimer::singleShot( 0, this, [this]() {
                if( !ratingWindowIsForeground() || ( rateAllowed_ && !rateAllowed_() ) ) return;
                if( !captureRating() )
                    QMessageBox::warning( this, tr( "Flubber rating unavailable" ),
                        tr( "Could not confine and hide the rating pointer." ) );
            } );
            event->accept();
            return;
        }
        QWidget::mouseReleaseEvent( event );
    }
    void paintEvent( QPaintEvent * ) Q_DECL_OVERRIDE
    {
        QPainter painter( this );
        painter.fillRect( rect(), Qt::black );
        painter.setRenderHint( QPainter::Antialiasing );
        const double radius = qMin( height(), width() / 3 ) * sizePercent_ / 220.0;
        const QPointF center( width() * xPercent_ / 100.0, height() * yPercent_ / 100.0 );
        QPainterPath path;
        const double smooth = mapped( "edgeSmoothness" );
        const double amplitude = mapped( "projectionAmplitude" );
        const double synchrony = mapped( "pulseSynchrony" );
        const double variation = mapped( "waveSizeVariation" );
        for( int i = 0; i < 192; ++i )
        {
            const double theta = i * 2 * M_PI / 192;
            const int waveIndex = ( i + 6 ) / 12 % 16;
            const double shape = pointy_[i] * ( 1 - smooth ) + rounded_[i] * smooth;
            const double wave = .5 + .5 * qSin( phase_ + ( 1 - synchrony ) * phases_[waveIndex] );
            const double asymmetry = 1 + variation * amplitudes_[waveIndex];
            const double deformation = ( 1 + shape * amplitude * wave * asymmetry ) * ( .95 + .05 * qSin( phase_ ) );
            const QPointF point( center.x() + radius * deformation * qCos( theta ),
                                 center.y() + radius * deformation * qSin( theta ) );
            if( i == 0 ) path.moveTo( point ); else path.lineTo( point );
        }
        path.closeSubpath();
        const QJsonObject visual = preset_.value( "visual" ).toObject();
        const QJsonObject colors = visual.value( "colors" ).toObject();
        const QJsonObject flubber = visual.value( "flubber" ).toObject();
        const QJsonObject halo = preset_.value( "presentation" ).toObject().value( "halo" ).toObject();
        const QColor fill = currentColor();
        const double opacity = 1 - visual.value( "transparency" ).toDouble();
        painter.setOpacity( opacity );
        if( flubber.value( "showHalo" ).toBool() && halo.value( "widthPercent" ).toDouble() > 0 )
        {
            QColor glow( colors.value( "halo" ).toString() );
            const double width = qMin( double( qMax( this->width(), this->height() ) * 2 ),
                qMax( 1.0, flubber.value( "outlineThickness" ).toDouble() * 3 )
                * halo.value( "widthPercent" ).toDouble() / 100 );
            painter.setBrush( Qt::NoBrush );
            if( halo.value( "gradient" ).toBool() )
            {
                const double steepness = halo.value( "steepness" ).toDouble();
                for( int layer = 6; layer >= 1; --layer )
                {
                    const double distance = double( layer ) / 6;
                    glow.setAlphaF( .13 * qPow( 1 - distance / 1.2, steepness ) );
                    painter.setPen( QPen( glow, width * distance,
                                           Qt::SolidLine, Qt::RoundCap, Qt::RoundJoin ) );
                    painter.drawPath( path );
                }
            }
            else
            {
                glow.setAlphaF( .65 );
                painter.setPen( QPen( glow, width, Qt::SolidLine, Qt::RoundCap, Qt::RoundJoin ) );
                painter.drawPath( path );
            }
        }
        painter.setBrush( fill );
        if( flubber.value( "showOutline" ).toBool() )
            painter.setPen( QPen( QColor( colors.value( "outline" ).toString() ),
                                  flubber.value( "outlineThickness" ).toDouble() ) );
        else painter.setPen( Qt::NoPen );
        painter.drawPath( path );
        /* Planner's cursor color belongs to its two-axis rating field. Keep
         * that exported color observable beside the Flubber in VLC as well. */
        const int fieldSize = qMin( 72, qMin( height() - 16, width() / 5 ) );
        if( fieldSize >= 24 )
        {
            const QRectF field( center.x() > width() / 2 ? 12 : width() - fieldSize - 12,
                                ( height() - fieldSize ) / 2.0, fieldSize, fieldSize );
            painter.setOpacity( opacity );
            painter.setBrush( Qt::NoBrush );
            painter.setPen( QPen( QColor( 90, 90, 90 ), 1 ) );
            painter.drawRect( field );
            painter.drawLine( QPointF( field.center().x(), field.top() ),
                              QPointF( field.center().x(), field.bottom() ) );
            painter.drawLine( QPointF( field.left(), field.center().y() ),
                              QPointF( field.right(), field.center().y() ) );
            const QPointF marker( field.center().x() + affectX_ * field.width() / 2,
                                  field.center().y() - affectY_ * field.height() / 2 );
            painter.setPen( QPen( Qt::black, 1 ) );
            painter.setBrush( QColor( colors.value( "cursor" ).toString() ) );
            painter.drawEllipse( marker, 4, 4 );
        }
    }

private:
    bool ratingWindowIsForeground() const
    {
#ifdef Q_OS_WIN
        const HWND owner = reinterpret_cast<HWND>( window()->winId() );
        const HWND foreground = GetForegroundWindow();
        return foreground && GetAncestor( foreground, GA_ROOT ) == owner;
#else
        return window()->isActiveWindow();
#endif
    }
    bool captureRating()
    {
        if( !ratingWindowIsForeground() ) return false;
#ifdef Q_OS_WIN
        const HWND owner = reinterpret_cast<HWND>( window()->winId() );
        RECT client = {};
        POINT topLeft = { 0, 0 };
        if( !GetClientRect( owner, &client ) || !ClientToScreen( owner, &topLeft ) ) return false;
        POINT bottomRight = { client.right, client.bottom };
        if( !ClientToScreen( owner, &bottomRight ) ) return false;
        const RECT bounds = { topLeft.x, topLeft.y, bottomRight.x, bottomRight.y };
        if( !ClipCursor( &bounds ) ) return false;
        if( SetCapture( reinterpret_cast<HWND>( winId() ) ) == NULL && GetCapture() == NULL )
        { ClipCursor( NULL ); return false; }
        for( ; cursorHideCalls_ < 32; ++cursorHideCalls_ )
        {
            const int count = ShowCursor( FALSE );
            if( count < 0 ) { ++cursorHideCalls_; break; }
        }
        if( cursorHideCalls_ == 32 ) { releaseRating(); return false; }
#else
        QApplication::setOverrideCursor( Qt::BlankCursor );
#endif
        ratingActive_ = true;
        setFocus( Qt::MouseFocusReason );
        QCursor::setPos( mapToGlobal( rect().center() ) );
        return true;
    }
    void releaseRating()
    {
        capturePending_ = false;
        if( !ratingActive_ && cursorHideCalls_ == 0 ) return;
#ifdef Q_OS_WIN
        if( GetCapture() == reinterpret_cast<HWND>( winId() ) ) ReleaseCapture();
        ClipCursor( NULL );
        while( cursorHideCalls_-- > 0 ) ShowCursor( TRUE );
        cursorHideCalls_ = 0;
#else
        QApplication::restoreOverrideCursor();
#endif
        ratingActive_ = false;
    }
    void interruptRating()
    {
        if( !ratingActive_ ) return;
        releaseRating();
        if( interrupted_ ) interrupted_();
    }
    void initializeShape()
    {
        double minimum = 1e100, maximum = -1e100;
        const double alpha = 3 * M_PI / 4;
        for( int i = 0; i < 192; ++i )
        {
            const double theta = i * 2 * M_PI / 192;
            rounded_[i] = ( qCos( 16 * theta ) + 1 ) / 2;
            const int distance = qAbs( i % 12 - 6 );
            pointy_[i] = qSin( alpha ) / qSin( M_PI - alpha - ( 2 * M_PI / 192 ) * distance );
            minimum = qMin( minimum, pointy_[i] );
            maximum = qMax( maximum, pointy_[i] );
        }
        for( int i = 0; i < 192; ++i ) pointy_[i] = ( pointy_[i] - minimum ) / ( maximum - minimum );

        // Exact 32-bit mulberry32 sequence used by Planner math.js for this seed.
        uint32_t seed = 2166136261u;
        const char *label = "affect-research-v1-preview";
        for( const unsigned char *p = reinterpret_cast<const unsigned char *>( label ); *p; ++p )
            seed = ( seed ^ *p ) * 16777619u;
        uint32_t value = seed;
        auto random = [&value]() {
            value += 0x6d2b79f5u;
            uint32_t result = value;
            result = ( result ^ ( result >> 15 ) ) * ( result | 1u );
            result ^= result + ( ( result ^ ( result >> 7 ) ) * ( result | 61u ) );
            return double( result ^ ( result >> 14 ) ) / 4294967296.0;
        };
        for( int i = 0; i < 16; ++i )
        {
            phases_[i] = ( random() * 2 - 1 ) * M_PI;
            amplitudes_[i] = random() * 2 - 1;
        }
    }
    static bool uniqueKeys( const QByteArray &bytes )
    {
        struct Frame { bool object; bool keyExpected; QSet<QString> keys; };
        QVector<Frame> frames;
        for( int i = 0; i < bytes.size(); ++i )
        {
            const char c = bytes.at( i );
            if( c == '{' ) frames.push_back( Frame{ true, true, {} } );
            else if( c == '[' ) frames.push_back( Frame{ false, false, {} } );
            else if( c == '}' || c == ']' ) { if( !frames.isEmpty() ) frames.removeLast(); }
            else if( c == ',' && !frames.isEmpty() && frames.last().object ) frames.last().keyExpected = true;
            else if( c == '"' )
            {
                const int start = i;
                ++i;
                for( ; i < bytes.size(); ++i )
                {
                    if( bytes.at( i ) == '\\' ) { ++i; continue; }
                    if( bytes.at( i ) == '"' ) break;
                }
                if( !frames.isEmpty() && frames.last().object && frames.last().keyExpected )
                {
                    const QByteArray quoted = bytes.mid( start, i - start + 1 );
                    const QString key = QJsonDocument::fromJson( QByteArray( "[" ) + quoted + "]" ).array().at( 0 ).toString();
                    if( frames.last().keys.contains( key ) ) return false;
                    frames.last().keys.insert( key );
                    frames.last().keyExpected = false;
                }
            }
        }
        return true;
    }
    static QSpinBox *spin( QWidget *parent, int min, int max, int value, const QString &suffix )
    {
        QSpinBox *box = new QSpinBox( parent );
        box->setRange( min, max ); box->setValue( value ); box->setSuffix( suffix );
        return box;
    }
    static bool keys( const QJsonObject &object, std::initializer_list<const char *> expected )
    {
        if( object.size() != int( expected.size() ) ) return false;
        for( const char *key : expected ) if( !object.contains( QLatin1String( key ) ) ) return false;
        return true;
    }
    static bool number( const QJsonValue &value, double lo, double hi )
    { return value.isDouble() && value.toDouble() >= lo && value.toDouble() <= hi; }
    double mapped( const char *name ) const
    {
        const QJsonObject m = preset_.value( "mappings" ).toObject().value( QLatin1String( name ) ).toObject();
        const QString driver = m.value( "drivenBy" ).toString();
        double t = 0;
        if( driver == QLatin1String( "x-axis" ) ) t = ( affectX_ + 1 ) / 2;
        else if( driver == QLatin1String( "y-axis" ) ) t = ( affectY_ + 1 ) / 2;
        else if( driver == QLatin1String( "radius" ) ) t = qMin( 1.0, qSqrt( affectX_*affectX_ + affectY_*affectY_ ) );
        else { t = qAtan2( affectY_, affectX_ ) / ( 2 * M_PI ); if( t < 0 ) t += 1; }
        if( m.value( "reverse" ).toBool() ) t = 1 - t;
        return m.value( "min" ).toDouble() + ( m.value( "max" ).toDouble() - m.value( "min" ).toDouble() ) * t;
    }
    QColor currentColor() const
    {
        const QJsonObject colors = preset_.value( "visual" ).toObject().value( "colors" ).toObject();
        if( qSqrt( affectX_*affectX_ + affectY_*affectY_ ) < .005 )
            return QColor( colors.value( "idle" ).toString() );
        const bool corners = preset_.value( "presentation" ).toObject().value( "colorAnchors" ).toString() == QLatin1String( "corners" );
        double weights[4];
        if( corners )
        {
            const double u = ( affectX_ + 1 ) / 2, v = ( affectY_ + 1 ) / 2;
            weights[0] = ( 1-u ) * v; weights[1] = u * ( 1-v );
            weights[2] = ( 1-u ) * ( 1-v ); weights[3] = u * v;
        }
        else
        {
            weights[0] = qMax( 0.0, affectY_ ); weights[1] = qMax( 0.0, -affectY_ );
            weights[2] = qMax( 0.0, -affectX_ ); weights[3] = qMax( 0.0, affectX_ );
            const double total = weights[0] + weights[1] + weights[2] + weights[3];
            if( total > 0 ) for( int i = 0; i < 4; ++i ) weights[i] /= total;
        }
        const char *names[] = { "up", "down", "left", "right" };
        const double saturation = mapped( "saturation" );
        double red = 183, green = 183, blue = 183;
        for( int i = 0; i < 4; ++i )
        {
            const QColor c( colors.value( QLatin1String( names[i] ) ).toString() );
            red += ( c.red() - 183 ) * weights[i] * saturation;
            green += ( c.green() - 183 ) * weights[i] * saturation;
            blue += ( c.blue() - 183 ) * weights[i] * saturation;
        }
        return QColor( qRound( red ), qRound( green ), qRound( blue ) );
    }
    static QJsonObject mapping( double lo, double hi, const char *driver, bool reverse = false )
    { return QJsonObject{ { "min", lo }, { "max", hi }, { "drivenBy", driver }, { "reverse", reverse } }; }
    static QJsonObject defaultPreset()
    {
        return QJsonObject{
            { "schema", "vlc-flubber-appearance/v1" },
            { "visual", QJsonObject{
                { "transparency", .05 },
                { "flubber", QJsonObject{ { "showOutline", true }, { "outlineThickness", 2 }, { "showHalo", true } } },
                { "colors", QJsonObject{ { "up", "#f2c94c" }, { "down", "#2f80ed" },
                    { "left", "#eb5757" }, { "right", "#27ae60" }, { "idle", "#9ca3af" },
                    { "outline", "#f8fafc" }, { "halo", "#93c5fd" }, { "cursor", "#ffffff" } } }
            } },
            { "presentation", QJsonObject{ { "colorAnchors", "axes" },
                { "halo", QJsonObject{ { "widthPercent", 150 }, { "gradient", true }, { "steepness", 1 } } } } },
            { "mappings", QJsonObject{
                { "oscillationFrequency", mapping( .5, 2.5, "y-axis" ) },
                { "edgeSmoothness", mapping( 0, 1, "x-axis" ) },
                { "projectionAmplitude", mapping( .2, .4, "y-axis" ) },
                { "pulseSynchrony", mapping( .2, 1, "x-axis" ) },
                { "waveSizeVariation", mapping( 0, .8, "x-axis", true ) },
                { "saturation", mapping( 0, 1, "radius" ) }
            } }
        };
    }
    QSettings *settings_;  // owned by VLC's main interface
    QJsonObject preset_;
    QString appearanceLoadError_;
    double affectX_, affectY_, phase_;
    int sizePercent_, xPercent_, yPercent_, panelHeight_;
    int panelPercent_, stepPercent_;
    QWidget *referenceSurface_; // VLC owns the sibling central surface
    bool ratingActive_;
    bool capturePending_;
    int cursorHideCalls_;
    std::function<void()> interrupted_;
    std::function<bool()> rateAllowed_;
    QElapsedTimer clock_;
    double pointy_[192], rounded_[192], phases_[16], amplitudes_[16];
};

#endif
