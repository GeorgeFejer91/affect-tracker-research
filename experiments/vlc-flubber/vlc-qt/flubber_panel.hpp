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
#include <QImage>
#include <QImageReader>
#include <QComboBox>
#include <QCheckBox>
#include <QDoubleSpinBox>
#include <QLineEdit>
#include <QTabWidget>
#include <QScrollArea>
#include <QGroupBox>
#include <QColorDialog>
#include <QSaveFile>
#include <QCoreApplication>
#include <QGridLayout>
#include <QHBoxLayout>
#include <algorithm>
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
    enum FeedbackKind { FlubberKind = 0, GridKind = 1, FaceKind = 2 };
    struct ElementLayout { bool visible; int size, x, y; };
    explicit FlubberPanel( QSettings *settings, QWidget *parent = NULL )
        : QWidget( parent ), settings_( settings ), affectX_( 0 ), affectY_( 0 ),
          phase_( 0 ), primary_( FlubberKind ), faceRate_( 10 ), faceX_( 0 ), faceY_( 0 ),
          panelHeight_( 130 ), panelPercent_( -1 ), stepPercent_( 10 ), referenceSurface_( NULL ),
          arrowMode_( settings_->value( "Flubber/inputMode", "mouse" ).toString() == QLatin1String( "arrows" ) ),
          ratingActive_( false ), capturePending_( false ), cursorHideCalls_( 0 )
    {
        setObjectName( "vlc-flubber-panel" );
        setMouseTracking( true );
        setFocusPolicy( Qt::ClickFocus );
        updateInputTooltip();
        setAutoFillBackground( true );
        QPalette p = palette();
        p.setColor( QPalette::Window, Qt::black );
        setPalette( p );
        setSizePolicy( QSizePolicy::Expanding, QSizePolicy::Fixed );
        const char *names[] = { "flubber", "grid", "face" };
        const int defaultX[] = { 50, 18, 82 };
        for( int i = 0; i < 3; ++i )
        {
            const QString key = QStringLiteral( "Flubber/layers/" ) + QLatin1String( names[i] ) + '/';
            layers_[i] = { settings_->value( key + "visible", i == 0 ).toBool(),
                qBound( 10, settings_->value( key + "size", i == 0
                    ? settings_->value( "Flubber/sizePercent", 65 ) : QVariant( 55 ) ).toInt(), 100 ),
                qBound( 0, settings_->value( key + "x", i == 0
                    ? settings_->value( "Flubber/xPercent", 50 ) : QVariant( defaultX[i] ) ).toInt(), 100 ),
                qBound( 0, settings_->value( key + "y", i == 0
                    ? settings_->value( "Flubber/yPercent", 50 ) : QVariant( 50 ) ).toInt(), 100 ) };
        }
        primary_ = kindFromName( settings_->value( "Flubber/primary", "flubber" ).toString() );
        grid_ = defaultGrid();
        grid_.insert( "lineThickness", settings_->value( "Flubber/gridLineThickness", 1.0 ).toDouble() );
        grid_.insert( "showOutline", settings_->value( "Flubber/gridShowOutline", true ).toBool() );
        grid_.insert( "outlineThickness", settings_->value( "Flubber/gridOutlineThickness", 2.0 ).toDouble() );
        grid_.insert( "cursorSize", settings_->value( "Flubber/gridCursorSize", 14.0 ).toDouble() );
        gridColumns_ = qBound( 3, settings_->value( "Flubber/gridColumns", 21 ).toInt() | 1, 2001 );
        gridRows_ = qBound( 3, settings_->value( "Flubber/gridRows", 21 ).toInt() | 1, 2001 );
        faceId_ = settings_->value( "Flubber/faceId", "photo-reference-v3" ).toString();
        faceRate_ = qBound( .5, settings_->value( "Flubber/faceRate", 10.0 ).toDouble(), 20.0 );
        panelHeight_ = qBound( 48, settings_->value( "Flubber/panelHeight", 130 ).toInt(), 2160 );
        bool parsed = false;
        const int requestedPanel = qEnvironmentVariableIntValue( "VLC_FLUBBER_PANEL_PERCENT", &parsed );
        if( parsed && requestedPanel >= 10 && requestedPanel <= 100 ) panelPercent_ = requestedPanel;
        const int requestedStep = qEnvironmentVariableIntValue( "VLC_FLUBBER_STEP_PERCENT", &parsed );
        if( parsed && requestedStep >= 1 && requestedStep <= 100 ) stepPercent_ = requestedStep;
        setFixedHeight( panelHeight_ );
        initializeShape();
        preset_ = defaultPreset();
        const QByteArray storedAppearance = settings_->value( "Flubber/appearanceJson" ).toByteArray();
        const QJsonDocument savedAppearance = QJsonDocument::fromJson( storedAppearance );
        if( savedAppearance.isObject() && savedAppearance.object().value( "schema" ).toString() ==
            QLatin1String( "vlc-flubber-appearance/v1" ) ) preset_ = savedAppearance.object();
        const QString path = settings_->value( "Flubber/appearancePath" ).toString();
        if( storedAppearance.isEmpty() && !path.isEmpty() )
        {
            QString error;
            QJsonObject loaded;
            if( readAppearance( path, loaded, error ) ) preset_ = loaded;
            else appearanceLoadError_ = error;
        }
        QString faceError;
        if( !setFaceId( faceId_, &faceError ) ) appearanceLoadError_ = faceError;
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
            const double faceStep = qMin<qint64>( elapsed, 100 ) * .001 * faceRate_ / 10;
            faceX_ += qBound( -faceStep, affectX_ - faceX_, faceStep );
            faceY_ += qBound( -faceStep, affectY_ - faceY_, faceStep );
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
    FeedbackKind primary() const { return primary_; }
    bool visible( FeedbackKind kind ) const { return layers_[kind].visible; }
    ElementLayout layoutFor( FeedbackKind kind ) const { return layers_[kind]; }
    QString faceId() const { return faceId_; }
    static QString kindName( FeedbackKind kind )
    { return kind == GridKind ? QStringLiteral( "grid" ) : kind == FaceKind ? QStringLiteral( "face" ) : QStringLiteral( "flubber" ); }
    static FeedbackKind kindFromName( const QString &name )
    { return name == QLatin1String( "grid" ) ? GridKind : name == QLatin1String( "face" ) ? FaceKind : FlubberKind; }
    static QStringList faceIds()
    {
        QStringList ids{ QStringLiteral( "photo-reference-v3" ) };
        for( int i = 1; i <= 8; ++i ) ids << QStringLiteral( "photo-synthetic-%1" ).arg( i, 2, 10, QLatin1Char( '0' ) );
        return ids;
    }
    static QString faceLabel( const QString &id )
    {
        if( id == QLatin1String( "photo-reference-v3" ) ) return QObject::tr( "Original portrait" );
        const int index = faceIds().indexOf( id );
        return index > 0 ? QObject::tr( "Synthetic preset %1" ).arg( index + 1 ) : QString();
    }
    bool setFaceId( const QString &id, QString *error = NULL )
    {
        if( !faceIds().contains( id ) )
        { if( error ) *error = tr( "Unknown face preset." ); return false; }
        const QString path = QCoreApplication::applicationDirPath() + "/assets/face/" + id + ".png";
        QImageReader reader( path, "png" );
        QImage image = reader.read();
        if( image.size() != QSize( 3360, 3360 ) )
        { if( error ) *error = tr( "The selected 21×21 face atlas is missing or invalid: %1 (%2)" )
            .arg( path, reader.errorString() ); return false; }
        faceAtlas_ = image;
        faceId_ = id;
        settings_->setValue( "Flubber/faceId", id );
        update();
        return true;
    }
    void setPrimary( FeedbackKind kind )
    {
        if( kind != primary_ )
        {
            std::swap( layers_[kind].size, layers_[primary_].size );
            std::swap( layers_[kind].x, layers_[primary_].x );
            std::swap( layers_[kind].y, layers_[primary_].y );
            persistLayout( primary_ );
            primary_ = kind;
            settings_->setValue( "Flubber/primary", kindName( kind ) );
        }
        setVisible( kind, true );
        persistLayout( kind );
        update();
    }
    void setVisible( FeedbackKind kind, bool enabled )
    {
        layers_[kind].visible = enabled;
        persistLayout( kind );
        update();
    }
    void setLayout( FeedbackKind kind, ElementLayout layout )
    {
        layout.size = qBound( 10, layout.size, 100 );
        layout.x = qBound( 0, layout.x, 100 );
        layout.y = qBound( 0, layout.y, 100 );
        layers_[kind] = layout;
        persistLayout( kind );
        update();
    }
    QJsonObject settingsJson() const
    {
        QJsonObject layers;
        for( int i = 0; i < 3; ++i )
        {
            const ElementLayout layer = layers_[i];
            layers.insert( kindName( static_cast<FeedbackKind>( i ) ), QJsonObject{
                { "visible", layer.visible }, { "size", layer.size }, { "x", layer.x }, { "y", layer.y } } );
        }
        QJsonObject grid = grid_;
        grid.insert( "columns", gridColumns_ );
        grid.insert( "rows", gridRows_ );
        return QJsonObject{ { "schema", "vlc-feedback-settings/v2" }, { "appearance", preset_ },
            { "panelHeight", panelHeight_ }, { "primary", kindName( primary_ ) },
            { "inputMode", arrowMode_ ? "arrows" : "mouse" }, { "layers", layers },
            { "grid", grid }, { "face", QJsonObject{ { "id", faceId_ }, { "transitionRate", faceRate_ } } } };
    }
    bool saveSettingsFile( const QString &path, QString &error ) const
    {
        QSaveFile file( path );
        if( !file.open( QIODevice::WriteOnly | QIODevice::Truncate ) ) { error = file.errorString(); return false; }
        if( file.write( QJsonDocument( settingsJson() ).toJson( QJsonDocument::Indented ) ) < 0 || !file.commit() )
        { error = file.errorString(); return false; }
        return true;
    }
    bool loadSettingsFile( const QString &path, QString &error )
    {
        QFile file( path );
        if( !file.open( QIODevice::ReadOnly ) ) { error = file.errorString(); return false; }
        if( file.size() > 131072 ) { error = tr( "Settings JSON exceeds 128 KiB." ); return false; }
        const QByteArray bytes = file.readAll();
        QJsonParseError parse;
        const QJsonDocument document = QJsonDocument::fromJson( bytes, &parse );
        if( parse.error != QJsonParseError::NoError || !document.isObject() || !uniqueKeys( bytes ) )
        { error = tr( "Invalid settings JSON or duplicate key." ); return false; }
        const QJsonObject root = document.object();
        if( root.value( "schema" ).toString() == QLatin1String( "vlc-flubber-appearance/v1" ) )
        {
            QJsonObject appearance;
            if( !readAppearance( path, appearance, error ) ) return false;
            preset_ = appearance;
            settings_->setValue( "Flubber/appearancePath", QFileInfo( path ).absoluteFilePath() );
            settings_->setValue( "Flubber/appearanceJson", QJsonDocument( preset_ ).toJson( QJsonDocument::Compact ) );
            update();
            return true;
        }
        if( root.value( "schema" ).toString() != QLatin1String( "vlc-feedback-settings/v2" ) ||
            !keys( root, { "schema", "appearance", "panelHeight", "primary", "inputMode", "layers", "grid", "face" } ) ||
            !root.value( "appearance" ).isObject() || !number( root.value( "panelHeight" ), 48, 2160 ) ||
            !root.value( "layers" ).isObject() || !root.value( "grid" ).isObject() || !root.value( "face" ).isObject() )
        { error = tr( "Unexpected settings schema or fields." ); return false; }
        const QString primaryName = root.value( "primary" ).toString();
        const QString input = root.value( "inputMode" ).toString();
        if( !QStringList{ "flubber", "grid", "face" }.contains( primaryName ) ||
            !QStringList{ "arrows", "mouse" }.contains( input ) )
        { error = tr( "Invalid primary feedback or input mode." ); return false; }
        QJsonObject appearance;
        if( !validateAppearanceObject( root.value( "appearance" ).toObject(), appearance, error ) ) return false;
        const QJsonObject layers = root.value( "layers" ).toObject();
        if( !keys( layers, { "flubber", "grid", "face" } ) )
        { error = tr( "Expected three feedback layers." ); return false; }
        ElementLayout parsedLayers[3];
        for( int i = 0; i < 3; ++i )
        {
            const QJsonObject layer = layers.value( kindName( static_cast<FeedbackKind>( i ) ) ).toObject();
            if( !keys( layer, { "visible", "size", "x", "y" } ) ||
                !layer.value( "visible" ).isBool() || !number( layer.value( "size" ), 10, 100 ) ||
                !number( layer.value( "x" ), 0, 100 ) || !number( layer.value( "y" ), 0, 100 ) )
            { error = tr( "Invalid feedback layer layout." ); return false; }
            parsedLayers[i] = { layer.value( "visible" ).toBool(), layer.value( "size" ).toInt(),
                layer.value( "x" ).toInt(), layer.value( "y" ).toInt() };
        }
        const QJsonObject grid = root.value( "grid" ).toObject();
        if( !keys( grid, { "columns", "rows", "lineThickness", "showOutline", "outlineThickness", "cursorSize" } ) ||
            !number( grid.value( "columns" ), 3, 2001 ) || !number( grid.value( "rows" ), 3, 2001 ) ||
            !( grid.value( "columns" ).toInt() & 1 ) || !( grid.value( "rows" ).toInt() & 1 ) ||
            !number( grid.value( "lineThickness" ), 0, 20 ) || !grid.value( "showOutline" ).isBool() ||
            !number( grid.value( "outlineThickness" ), 0, 20 ) || !number( grid.value( "cursorSize" ), 0, 100 ) )
        { error = tr( "Invalid grid settings." ); return false; }
        const QJsonObject face = root.value( "face" ).toObject();
        if( !keys( face, { "id", "transitionRate" } ) || !faceIds().contains( face.value( "id" ).toString() ) ||
            !number( face.value( "transitionRate" ), .5, 20 ) )
        { error = tr( "Invalid face settings." ); return false; }
        QImageReader atlasReader( QCoreApplication::applicationDirPath() + "/assets/face/" + face.value( "id" ).toString() + ".png", "png" );
        QImage atlas = atlasReader.read();
        if( atlas.size() != QSize( 3360, 3360 ) )
        { error = tr( "The chosen face atlas is missing or invalid: %1" ).arg( atlasReader.errorString() ); return false; }
        preset_ = appearance;
        primary_ = kindFromName( primaryName );
        for( int i = 0; i < 3; ++i ) { layers_[i] = parsedLayers[i]; persistLayout( static_cast<FeedbackKind>( i ) ); }
        grid_ = grid; grid_.remove( "columns" ); grid_.remove( "rows" );
        gridColumns_ = grid.value( "columns" ).toInt(); gridRows_ = grid.value( "rows" ).toInt();
        faceId_ = face.value( "id" ).toString(); faceAtlas_ = atlas;
        faceRate_ = face.value( "transitionRate" ).toDouble();
        if( panelPercent_ < 0 ) { panelHeight_ = root.value( "panelHeight" ).toInt(); setFixedHeight( panelHeight_ ); }
        setArrowMode( input == QLatin1String( "arrows" ) );
        settings_->setValue( "Flubber/primary", primaryName );
        settings_->setValue( "Flubber/panelHeight", panelHeight_ );
        settings_->setValue( "Flubber/gridColumns", gridColumns_ ); settings_->setValue( "Flubber/gridRows", gridRows_ );
        settings_->setValue( "Flubber/gridLineThickness", grid_.value( "lineThickness" ).toDouble() );
        settings_->setValue( "Flubber/gridShowOutline", grid_.value( "showOutline" ).toBool() );
        settings_->setValue( "Flubber/gridOutlineThickness", grid_.value( "outlineThickness" ).toDouble() );
        settings_->setValue( "Flubber/gridCursorSize", grid_.value( "cursorSize" ).toDouble() );
        settings_->setValue( "Flubber/faceId", faceId_ ); settings_->setValue( "Flubber/faceRate", faceRate_ );
        settings_->setValue( "Flubber/appearancePath", QString() );
        settings_->setValue( "Flubber/appearanceJson", QJsonDocument( preset_ ).toJson( QJsonDocument::Compact ) );
        update();
        return true;
    }
    QString appearanceLoadError() const { return appearanceLoadError_; }
    bool ratingActive() const { return ratingActive_; }
    void stopRating() { releaseRating(); }
    bool arrowMode() const { return arrowMode_; }
    void setArrowMode( bool enabled )
    {
        releaseRating();
        arrowMode_ = enabled;
        settings_->setValue( "Flubber/inputMode", enabled ? "arrows" : "mouse" );
        updateInputTooltip();
        if( enabled && ratingWindowIsForeground() ) setFocus( Qt::ShortcutFocusReason );
    }
    void setVideoAffect( double valence, double arousal )
    {
        if( !arrowMode_ && !ratingActive_ ) setAffect( valence, arousal );
    }
    bool handleArrowKey( QKeyEvent *event )
    {
        if( !arrowMode_ || ( rateAllowed_ && !rateAllowed_() ) ||
            ( event->modifiers() & ~Qt::KeypadModifier ) ) return false;
        const double step = stepPercent_ / 100.0;
        switch( event->key() )
        {
            case Qt::Key_Left: setAffect( affectX_ - step, affectY_ ); break;
            case Qt::Key_Right: setAffect( affectX_ + step, affectY_ ); break;
            case Qt::Key_Up: setAffect( affectX_, affectY_ + step ); break;
            case Qt::Key_Down: setAffect( affectX_, affectY_ - step ); break;
            default: return false;
        }
        event->accept();
        return true;
    }
    void setInterruptHandler( const std::function<void()> &handler ) { interrupted_ = handler; }
    void setRateAllowedHandler( const std::function<bool()> &handler ) { rateAllowed_ = handler; }
    void setReferenceSurface( QWidget *surface ) { referenceSurface_ = surface; }

    void showControls( QWidget *parent )
    {
        QDialog dialog( parent );
        dialog.setWindowTitle( tr( "Flubber Controls" ) );
        dialog.resize( 650, 640 );
        QJsonObject pendingPreset = preset_;
        QString pendingPath = settings_->value( "Flubber/appearancePath" ).toString();
        QVBoxLayout *layout = new QVBoxLayout( &dialog );
        QTabWidget *tabs = new QTabWidget( &dialog );
        layout->addWidget( tabs );
        auto page = [tabs]( const QString &title ) {
            QScrollArea *scroll = new QScrollArea( tabs );
            scroll->setWidgetResizable( true );
            QWidget *body = new QWidget( scroll );
            QFormLayout *form = new QFormLayout( body );
            form->setFieldGrowthPolicy( QFormLayout::ExpandingFieldsGrow );
            scroll->setWidget( body ); tabs->addTab( scroll, title );
            return form;
        };
        auto real = [&dialog]( double min, double max, double value, int decimals = 2 ) {
            QDoubleSpinBox *box = new QDoubleSpinBox( &dialog );
            box->setRange( min, max ); box->setDecimals( decimals ); box->setValue( value );
            box->setSingleStep( decimals == 1 ? .1 : .05 );
            return box;
        };
        QFormLayout *display = page( tr( "Display" ) );
        QSpinBox *height = spin( &dialog, 48, 2160, panelHeight_, tr( " px" ) );
        height->setObjectName( "flubber-panel-height" );
        if( panelPercent_ > 0 )
        {
            height->setValue( this->height() );
            height->setEnabled( false );
            height->setToolTip( tr( "Panel height is controlled by this Recorder session." ) );
        }
        display->addRow( tr( "Bottom panel height" ), height );
        QComboBox *primaryBox = new QComboBox( &dialog );
        primaryBox->addItems( { tr( "Flubber" ), tr( "2D grid" ), tr( "Face morph" ) } );
        primaryBox->setCurrentIndex( primary_ ); display->addRow( tr( "Main feedback" ), primaryBox );
        QComboBox *inputBox = new QComboBox( &dialog );
        inputBox->addItems( { tr( "Mouse" ), tr( "Arrow keys" ) } );
        inputBox->setCurrentIndex( arrowMode_ ? 1 : 0 ); display->addRow( tr( "Input mode" ), inputBox );
        QCheckBox *shown[3]; QSpinBox *size[3], *x[3], *y[3];
        for( int i = 0; i < 3; ++i )
        {
            const QString name = i == 0 ? tr( "Flubber" ) : i == 1 ? tr( "2D grid" ) : tr( "Face morph" );
            shown[i] = new QCheckBox( tr( "Show" ), &dialog ); shown[i]->setChecked( layers_[i].visible );
            size[i] = spin( &dialog, 10, 100, layers_[i].size, tr( " %" ) );
            x[i] = spin( &dialog, 0, 100, layers_[i].x, tr( " %" ) );
            y[i] = spin( &dialog, 0, 100, layers_[i].y, tr( " %" ) );
            size[i]->setObjectName( QStringLiteral( "flubber-layer-%1-size" ).arg( i ) );
            x[i]->setObjectName( QStringLiteral( "flubber-layer-%1-x" ).arg( i ) );
            y[i]->setObjectName( QStringLiteral( "flubber-layer-%1-y" ).arg( i ) );
            QWidget *row = new QWidget( &dialog ); QHBoxLayout *line = new QHBoxLayout( row );
            line->setContentsMargins( 0, 0, 0, 0 );
            line->addWidget( shown[i] ); line->addWidget( new QLabel( tr( "Size" ), row ) ); line->addWidget( size[i] );
            line->addWidget( new QLabel( tr( "X" ), row ) ); line->addWidget( x[i] );
            line->addWidget( new QLabel( tr( "Y" ), row ) ); line->addWidget( y[i] );
            display->addRow( name, row );
        }
        display->addRow( new QLabel( tr( "Ctrl+Shift+1/2/3 selects the main feedback. Ctrl+Shift+A/M selects arrow or mouse input." ), &dialog ) );
        QFormLayout *flubberForm = page( tr( "Flubber" ) );
        QJsonObject visual = pendingPreset.value( "visual" ).toObject();
        QJsonObject shape = visual.value( "flubber" ).toObject();
        QJsonObject presentation = pendingPreset.value( "presentation" ).toObject();
        QJsonObject halo = presentation.value( "halo" ).toObject();
        QDoubleSpinBox *transparency = real( 0, 1, visual.value( "transparency" ).toDouble() );
        QCheckBox *outline = new QCheckBox( &dialog ); outline->setChecked( shape.value( "showOutline" ).toBool() );
        QDoubleSpinBox *outlineThickness = real( 0, 20, shape.value( "outlineThickness" ).toDouble() );
        QCheckBox *showHalo = new QCheckBox( &dialog ); showHalo->setChecked( shape.value( "showHalo" ).toBool() );
        QDoubleSpinBox *haloWidth = real( 0, 10000, halo.value( "widthPercent" ).toDouble() );
        QCheckBox *haloGradient = new QCheckBox( &dialog ); haloGradient->setChecked( halo.value( "gradient" ).toBool() );
        QDoubleSpinBox *haloSteepness = real( .1, 10, halo.value( "steepness" ).toDouble() );
        QComboBox *anchors = new QComboBox( &dialog ); anchors->addItems( { tr( "Axes" ), tr( "Corners" ) } );
        anchors->setCurrentIndex( presentation.value( "colorAnchors" ).toString() == QLatin1String( "corners" ) ? 1 : 0 );
        flubberForm->addRow( tr( "Transparency" ), transparency );
        flubberForm->addRow( tr( "Outline" ), outline ); flubberForm->addRow( tr( "Outline thickness" ), outlineThickness );
        flubberForm->addRow( tr( "Halo" ), showHalo ); flubberForm->addRow( tr( "Halo width (%)" ), haloWidth );
        flubberForm->addRow( tr( "Halo gradient" ), haloGradient ); flubberForm->addRow( tr( "Halo steepness" ), haloSteepness );
        flubberForm->addRow( tr( "Color anchors" ), anchors );
        QFormLayout *colorForm = page( tr( "Colors" ) );
        const char *colorNames[] = { "up", "down", "left", "right", "idle", "outline", "halo", "cursor" };
        QPushButton *colorButtons[8];
        for( int i = 0; i < 8; ++i )
        {
            colorButtons[i] = new QPushButton( &dialog );
            const QString color = visual.value( "colors" ).toObject().value( QLatin1String( colorNames[i] ) ).toString();
            colorButtons[i]->setText( color );
            colorButtons[i]->setStyleSheet( "background-color: " + color + ";" );
            colorForm->addRow( QString::fromLatin1( colorNames[i] ), colorButtons[i] );
            connect( colorButtons[i], &QPushButton::clicked, &dialog, [&, i]() {
                const QColor chosen = QColorDialog::getColor( QColor( colorButtons[i]->text() ), &dialog );
                if( chosen.isValid() ) { colorButtons[i]->setText( chosen.name() );
                    colorButtons[i]->setStyleSheet( "background-color: " + chosen.name() + ";" ); }
            } );
        }
        QFormLayout *mappingForm = page( tr( "Mappings" ) );
        const char *mappingNames[] = { "oscillationFrequency", "edgeSmoothness", "projectionAmplitude",
            "pulseSynchrony", "waveSizeVariation", "saturation" };
        QDoubleSpinBox *mappingMin[6], *mappingMax[6]; QComboBox *mappingDriver[6]; QCheckBox *mappingReverse[6];
        const QString drivers[] = { "x-axis", "y-axis", "angle", "radius" };
        for( int i = 0; i < 6; ++i )
        {
            const QJsonObject entry = pendingPreset.value( "mappings" ).toObject().value( QLatin1String( mappingNames[i] ) ).toObject();
            QWidget *row = new QWidget( &dialog ); QHBoxLayout *line = new QHBoxLayout( row ); line->setContentsMargins( 0, 0, 0, 0 );
            mappingMin[i] = real( 0, i == 0 ? 10 : 1, entry.value( "min" ).toDouble() );
            mappingMax[i] = real( 0, i == 0 ? 10 : 1, entry.value( "max" ).toDouble() );
            mappingDriver[i] = new QComboBox( row ); mappingDriver[i]->addItems( { "x-axis", "y-axis", "angle", "radius" } );
            for( int d = 0; d < 4; ++d ) if( entry.value( "drivenBy" ).toString() == drivers[d] ) mappingDriver[i]->setCurrentIndex( d );
            mappingReverse[i] = new QCheckBox( tr( "Reverse" ), row ); mappingReverse[i]->setChecked( entry.value( "reverse" ).toBool() );
            line->addWidget( new QLabel( tr( "Min" ), row ) ); line->addWidget( mappingMin[i] );
            line->addWidget( new QLabel( tr( "Max" ), row ) ); line->addWidget( mappingMax[i] );
            line->addWidget( mappingDriver[i] ); line->addWidget( mappingReverse[i] );
            mappingForm->addRow( QString::fromLatin1( mappingNames[i] ), row );
        }
        QFormLayout *gridForm = page( tr( "2D grid" ) );
        QSpinBox *columns = spin( &dialog, 3, 2001, gridColumns_, QString() ); columns->setSingleStep( 2 );
        QSpinBox *rows = spin( &dialog, 3, 2001, gridRows_, QString() ); rows->setSingleStep( 2 );
        QDoubleSpinBox *gridLine = real( 0, 20, grid_.value( "lineThickness" ).toDouble() );
        QCheckBox *gridOutline = new QCheckBox( &dialog ); gridOutline->setChecked( grid_.value( "showOutline" ).toBool() );
        QDoubleSpinBox *gridOutlineThickness = real( 0, 20, grid_.value( "outlineThickness" ).toDouble() );
        QDoubleSpinBox *cursorSize = real( 0, 100, grid_.value( "cursorSize" ).toDouble() );
        gridForm->addRow( tr( "Columns (odd)" ), columns ); gridForm->addRow( tr( "Rows (odd)" ), rows );
        gridForm->addRow( tr( "Line thickness" ), gridLine ); gridForm->addRow( tr( "Outline" ), gridOutline );
        gridForm->addRow( tr( "Outline thickness" ), gridOutlineThickness ); gridForm->addRow( tr( "Cursor size" ), cursorSize );
        QFormLayout *faceForm = page( tr( "Face morph" ) );
        QComboBox *face = new QComboBox( &dialog );
        for( const QString &id : faceIds() ) face->addItem( faceLabel( id ), id );
        face->setCurrentIndex( qMax( 0, faceIds().indexOf( faceId_ ) ) );
        QDoubleSpinBox *faceRate = real( .5, 20, faceRate_, 1 );
        faceForm->addRow( tr( "Portrait preset" ), face ); faceForm->addRow( tr( "Transition speed (states/s)" ), faceRate );
        faceForm->addRow( new QLabel( tr( "The selected portrait uses the archived 21×21 smooth face transition matrix." ), &dialog ) );
        QHBoxLayout *fileButtons = new QHBoxLayout;
        QPushButton *loadAppearance = new QPushButton( tr( "Load appearance JSON…" ), &dialog );
        QPushButton *loadSettings = new QPushButton( tr( "Load settings JSON…" ), &dialog );
        QPushButton *saveAppearance = new QPushButton( tr( "Export appearance…" ), &dialog );
        QPushButton *saveSettings = new QPushButton( tr( "Export settings…" ), &dialog );
        fileButtons->addWidget( loadAppearance ); fileButtons->addWidget( loadSettings );
        fileButtons->addWidget( saveAppearance ); fileButtons->addWidget( saveSettings );
        layout->addLayout( fileButtons );
        QLabel *current = new QLabel( pendingPath.isEmpty() ? tr( "Default Flubber appearance" ) : pendingPath, &dialog );
        current->setWordWrap( true ); layout->addWidget( current );
        connect( loadAppearance, &QPushButton::clicked, &dialog, [&]() {
            const QString path = QFileDialog::getOpenFileName( &dialog,
                tr( "Load Flubber appearance" ), QString(), tr( "JSON files (*.json)" ) );
            if( path.isEmpty() ) return;
            QJsonObject next;
            QString error;
            if( !readAppearance( path, next, error ) )
            {
                QMessageBox::warning( &dialog, tr( "Invalid Flubber appearance" ), error );
                return;
            }
            pendingPreset = next; pendingPath = QFileInfo( path ).absoluteFilePath(); current->setText( path );
            const QJsonObject v = next.value( "visual" ).toObject(), s = v.value( "flubber" ).toObject();
            const QJsonObject p = next.value( "presentation" ).toObject(), h = p.value( "halo" ).toObject();
            transparency->setValue( v.value( "transparency" ).toDouble() );
            outline->setChecked( s.value( "showOutline" ).toBool() ); outlineThickness->setValue( s.value( "outlineThickness" ).toDouble() );
            showHalo->setChecked( s.value( "showHalo" ).toBool() ); haloWidth->setValue( h.value( "widthPercent" ).toDouble() );
            haloGradient->setChecked( h.value( "gradient" ).toBool() ); haloSteepness->setValue( h.value( "steepness" ).toDouble() );
            anchors->setCurrentIndex( p.value( "colorAnchors" ).toString() == QLatin1String( "corners" ) ? 1 : 0 );
            for( int i = 0; i < 8; ++i )
            { const QString c = v.value( "colors" ).toObject().value( QLatin1String( colorNames[i] ) ).toString();
                colorButtons[i]->setText( c ); colorButtons[i]->setStyleSheet( "background-color: " + c + ";" ); }
            for( int i = 0; i < 6; ++i )
            { const QJsonObject m = next.value( "mappings" ).toObject().value( QLatin1String( mappingNames[i] ) ).toObject();
                mappingMin[i]->setValue( m.value( "min" ).toDouble() ); mappingMax[i]->setValue( m.value( "max" ).toDouble() );
                mappingDriver[i]->setCurrentText( m.value( "drivenBy" ).toString() );
                mappingReverse[i]->setChecked( m.value( "reverse" ).toBool() ); }
        } );
        QString requestedFile;
        connect( loadSettings, &QPushButton::clicked, &dialog, [&]() {
            requestedFile = QFileDialog::getOpenFileName( &dialog, tr( "Load Flubber settings" ), QString(), tr( "JSON files (*.json)" ) );
            if( !requestedFile.isEmpty() ) dialog.done( 2 );
        } );
        connect( saveAppearance, &QPushButton::clicked, &dialog, [&]() {
            requestedFile = QFileDialog::getSaveFileName( &dialog, tr( "Export Flubber appearance" ), "flubber-appearance.json", tr( "JSON files (*.json)" ) );
            if( !requestedFile.isEmpty() ) dialog.done( 3 );
        } );
        connect( saveSettings, &QPushButton::clicked, &dialog, [&]() {
            requestedFile = QFileDialog::getSaveFileName( &dialog, tr( "Export Flubber settings" ), "flubber-settings.json", tr( "JSON files (*.json)" ) );
            if( !requestedFile.isEmpty() ) dialog.done( 4 );
        } );
        QDialogButtonBox *buttons = new QDialogButtonBox( QDialogButtonBox::Ok | QDialogButtonBox::Cancel, &dialog );
        layout->addWidget( buttons );
        connect( buttons, &QDialogButtonBox::accepted, &dialog, &QDialog::accept );
        connect( buttons, &QDialogButtonBox::rejected, &dialog, &QDialog::reject );
        const int result = dialog.exec();
        if( result == 2 )
        {
            QString error;
            if( !loadSettingsFile( requestedFile, error ) ) QMessageBox::warning( parent, tr( "Invalid Flubber settings" ), error );
            return;
        }
        if( result == QDialog::Accepted || result == 3 || result == 4 )
        {
            if( ( columns->value() & 1 ) == 0 || ( rows->value() & 1 ) == 0 )
            { QMessageBox::warning( parent, tr( "Invalid grid" ), tr( "Grid columns and rows must be odd." ) ); return; }
            for( int i = 0; i < 6; ++i ) if( mappingMin[i]->value() > mappingMax[i]->value() )
            { QMessageBox::warning( parent, tr( "Invalid mapping" ), tr( "Each mapping minimum must not exceed its maximum." ) ); return; }
            QString faceError;
            if( !setFaceId( face->currentData().toString(), &faceError ) )
            { QMessageBox::warning( parent, tr( "Invalid face atlas" ), faceError ); return; }
            visual = pendingPreset.value( "visual" ).toObject();
            shape = visual.value( "flubber" ).toObject();
            shape.insert( "showOutline", outline->isChecked() ); shape.insert( "outlineThickness", outlineThickness->value() );
            shape.insert( "showHalo", showHalo->isChecked() ); visual.insert( "flubber", shape );
            visual.insert( "transparency", transparency->value() );
            QJsonObject colors = visual.value( "colors" ).toObject();
            for( int i = 0; i < 8; ++i ) colors.insert( QLatin1String( colorNames[i] ), colorButtons[i]->text() );
            visual.insert( "colors", colors ); pendingPreset.insert( "visual", visual );
            presentation = pendingPreset.value( "presentation" ).toObject();
            halo = presentation.value( "halo" ).toObject();
            halo.insert( "widthPercent", haloWidth->value() ); halo.insert( "gradient", haloGradient->isChecked() );
            halo.insert( "steepness", haloSteepness->value() ); presentation.insert( "halo", halo );
            presentation.insert( "colorAnchors", anchors->currentIndex() == 1 ? "corners" : "axes" );
            pendingPreset.insert( "presentation", presentation );
            QJsonObject mappings = pendingPreset.value( "mappings" ).toObject();
            for( int i = 0; i < 6; ++i ) mappings.insert( QLatin1String( mappingNames[i] ), QJsonObject{
                { "min", mappingMin[i]->value() }, { "max", mappingMax[i]->value() },
                { "drivenBy", mappingDriver[i]->currentText() }, { "reverse", mappingReverse[i]->isChecked() } } );
            pendingPreset.insert( "mappings", mappings );
            preset_ = pendingPreset;
            settings_->setValue( "Flubber/appearancePath", pendingPath );
            settings_->setValue( "Flubber/appearanceJson", QJsonDocument( preset_ ).toJson( QJsonDocument::Compact ) );
            if( panelPercent_ < 0 ) { panelHeight_ = height->value(); setFixedHeight( panelHeight_ );
                settings_->setValue( "Flubber/panelHeight", panelHeight_ ); }
            for( int i = 0; i < 3; ++i ) setLayout( static_cast<FeedbackKind>( i ),
                ElementLayout{ shown[i]->isChecked(), size[i]->value(), x[i]->value(), y[i]->value() } );
            primary_ = static_cast<FeedbackKind>( primaryBox->currentIndex() );
            settings_->setValue( "Flubber/primary", kindName( primary_ ) );
            setArrowMode( inputBox->currentIndex() == 1 );
            gridColumns_ = columns->value(); gridRows_ = rows->value();
            grid_.insert( "lineThickness", gridLine->value() ); grid_.insert( "showOutline", gridOutline->isChecked() );
            grid_.insert( "outlineThickness", gridOutlineThickness->value() ); grid_.insert( "cursorSize", cursorSize->value() );
            settings_->setValue( "Flubber/gridColumns", gridColumns_ ); settings_->setValue( "Flubber/gridRows", gridRows_ );
            settings_->setValue( "Flubber/gridLineThickness", gridLine->value() );
            settings_->setValue( "Flubber/gridShowOutline", gridOutline->isChecked() );
            settings_->setValue( "Flubber/gridOutlineThickness", gridOutlineThickness->value() );
            settings_->setValue( "Flubber/gridCursorSize", cursorSize->value() );
            faceRate_ = faceRate->value(); settings_->setValue( "Flubber/faceRate", faceRate_ );
            update();
            if( result == 3 || result == 4 )
            {
                QSaveFile file( requestedFile );
                QString error;
                if( result == 4 ) { if( !saveSettingsFile( requestedFile, error ) )
                    QMessageBox::warning( parent, tr( "Could not export settings" ), error ); }
                else if( !file.open( QIODevice::WriteOnly | QIODevice::Truncate ) ||
                    file.write( QJsonDocument( preset_ ).toJson( QJsonDocument::Indented ) ) < 0 || !file.commit() )
                    QMessageBox::warning( parent, tr( "Could not export appearance" ), file.errorString() );
            }
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
        return validateAppearanceObject( document.object(), out, error );
    }
    static bool validateAppearanceObject( const QJsonObject &root, QJsonObject &out, QString &error )
    {
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
        if( arrowMode_ && event->type() == QEvent::KeyPress &&
            !QApplication::activeModalWidget() && !QApplication::activePopupWidget() &&
            ratingWindowIsForeground() && ( !rateAllowed_ || rateAllowed_() ) )
        {
            QWidget *target = qobject_cast<QWidget *>( watched );
            if( target && target->window() == window() &&
                handleArrowKey( static_cast<QKeyEvent *>( event ) ) ) return true;
        }
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
        QWidget::keyPressEvent( event );
    }
    void mouseMoveEvent( QMouseEvent *event ) Q_DECL_OVERRIDE
    {
        if( arrowMode_ ) { QWidget::mouseMoveEvent( event ); return; }
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
        if( event->button() == Qt::LeftButton && !arrowMode_ && !ratingActive_ )
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
        for( int i = 0; i < 3; ++i )
        {
            const FeedbackKind kind = static_cast<FeedbackKind>( i );
            if( kind == primary_ || !layers_[i].visible ) continue;
            drawElement( painter, kind );
        }
        if( layers_[primary_].visible ) drawElement( painter, primary_ );
    }

private:
    void drawElement( QPainter &painter, FeedbackKind kind )
    {
        painter.save();
        if( kind == GridKind ) drawGrid( painter );
        else if( kind == FaceKind ) drawFace( painter );
        else drawFlubber( painter );
        painter.restore();
    }
    QPointF elementCenter( FeedbackKind kind ) const
    { return QPointF( width() * layers_[kind].x / 100.0, height() * layers_[kind].y / 100.0 ); }
    double elementSide( FeedbackKind kind ) const
    { return qMin( double( height() ), double( width() ) / 2.0 ) * layers_[kind].size / 100.0; }
    void drawFlubber( QPainter &painter )
    {
        const double radius = elementSide( FlubberKind ) * .47;
        const QPointF center = elementCenter( FlubberKind );
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
    }
    void drawGrid( QPainter &painter )
    {
        const double side = qMax( 20.0, elementSide( GridKind ) );
        const QPointF center = elementCenter( GridKind );
        const QRectF field( center.x() - side / 2, center.y() - side / 2, side, side );
        const QJsonObject colors = preset_.value( "visual" ).toObject().value( "colors" ).toObject();
        const QColor up( colors.value( "up" ).toString() ), down( colors.value( "down" ).toString() );
        const QColor left( colors.value( "left" ).toString() ), right( colors.value( "right" ).toString() );
        QImage fieldImage( qMax( 1, int( side ) ), qMax( 1, int( side ) ), QImage::Format_ARGB32_Premultiplied );
        const bool corners = preset_.value( "presentation" ).toObject().value( "colorAnchors" ).toString() == QLatin1String( "corners" );
        const double opacity = 1 - preset_.value( "visual" ).toObject().value( "transparency" ).toDouble();
        for( int py = 0; py < fieldImage.height(); ++py )
        {
            QRgb *line = reinterpret_cast<QRgb *>( fieldImage.scanLine( py ) );
            const double v = 1 - 2.0 * py / qMax( 1, fieldImage.height() - 1 );
            for( int px = 0; px < fieldImage.width(); ++px )
            {
                const double u = 2.0 * px / qMax( 1, fieldImage.width() - 1 ) - 1;
                double w[4];
                if( corners )
                {
                    const double x = ( u + 1 ) / 2, y = ( v + 1 ) / 2;
                    w[0] = ( 1 - x ) * y; w[1] = x * ( 1 - y );
                    w[2] = ( 1 - x ) * ( 1 - y ); w[3] = x * y;
                }
                else
                {
                    w[0] = qMax( 0.0, v ); w[1] = qMax( 0.0, -v );
                    w[2] = qMax( 0.0, -u ); w[3] = qMax( 0.0, u );
                    const double total = w[0] + w[1] + w[2] + w[3];
                    for( double &weight : w ) weight = total > 0 ? weight / total : 0;
                }
                const QColor anchors[4] = { up, down, left, right };
                double rgb[3] = { 183, 183, 183 };
                for( int a = 0; a < 4; ++a )
                {
                    rgb[0] += ( anchors[a].red() - 183 ) * w[a];
                    rgb[1] += ( anchors[a].green() - 183 ) * w[a];
                    rgb[2] += ( anchors[a].blue() - 183 ) * w[a];
                }
                line[px] = qRgba( qBound( 0, qRound( rgb[0] * opacity ), 255 ),
                                  qBound( 0, qRound( rgb[1] * opacity ), 255 ),
                                  qBound( 0, qRound( rgb[2] * opacity ), 255 ), qRound( opacity * 255 ) );
            }
        }
        painter.drawImage( field, fieldImage );
        painter.setPen( QPen( QColor( 255, 255, 255, 80 ), grid_.value( "lineThickness" ).toDouble() ) );
        for( int col = 1; col < gridColumns_ - 1; ++col )
        {
            const double x = field.left() + field.width() * col / ( gridColumns_ - 1 );
            painter.drawLine( QPointF( x, field.top() ), QPointF( x, field.bottom() ) );
        }
        for( int row = 1; row < gridRows_ - 1; ++row )
        {
            const double y = field.top() + field.height() * row / ( gridRows_ - 1 );
            painter.drawLine( QPointF( field.left(), y ), QPointF( field.right(), y ) );
        }
        if( grid_.value( "showOutline" ).toBool() )
        {
            painter.setBrush( Qt::NoBrush );
            painter.setPen( QPen( QColor( colors.value( "outline" ).toString() ), grid_.value( "outlineThickness" ).toDouble() ) );
            painter.drawRect( field );
        }
        const QPointF marker( field.center().x() + affectX_ * field.width() / 2,
                              field.center().y() - affectY_ * field.height() / 2 );
        painter.setPen( Qt::NoPen );
        painter.setBrush( QColor( colors.value( "cursor" ).toString() ) );
        painter.drawEllipse( marker, grid_.value( "cursorSize" ).toDouble() / 2,
                             grid_.value( "cursorSize" ).toDouble() / 2 );
    }
    void drawFace( QPainter &painter )
    {
        if( faceAtlas_.isNull() ) return;
        const double side = qMax( 20.0, elementSide( FaceKind ) );
        const QPointF center = elementCenter( FaceKind );
        const QRectF target( center.x() - side / 2, center.y() - side / 2, side, side );
        const double gx = ( faceX_ + 1 ) * 10, gy = ( 1 - faceY_ ) * 10;
        const int x0 = qBound( 0, int( qFloor( gx ) ), 20 ), y0 = qBound( 0, int( qFloor( gy ) ), 20 );
        const int x1 = qMin( 20, x0 + 1 ), y1 = qMin( 20, y0 + 1 );
        const double dx = gx - x0, dy = gy - y0;
        const int col[4] = { x0, x1, x0, x1 }, row[4] = { y0, y0, y1, y1 };
        const double weight[4] = { ( 1 - dx ) * ( 1 - dy ), dx * ( 1 - dy ), ( 1 - dx ) * dy, dx * dy };
        QImage mixed( 160, 160, QImage::Format_ARGB32_Premultiplied );
        mixed.fill( Qt::transparent );
        QPainter mix( &mixed );
        mix.setCompositionMode( QPainter::CompositionMode_Plus );
        for( int i = 0; i < 4; ++i )
        {
            if( weight[i] <= 0 ) continue;
            mix.setOpacity( weight[i] );
            mix.drawImage( QRectF( 0, 0, 160, 160 ), faceAtlas_, QRectF( col[i] * 160, row[i] * 160, 160, 160 ) );
        }
        mix.end();
        painter.drawImage( target, mixed );
    }
    void persistLayout( FeedbackKind kind )
    {
        const QString key = QStringLiteral( "Flubber/layers/" ) + kindName( kind ) + '/';
        const ElementLayout layout = layers_[kind];
        settings_->setValue( key + "visible", layout.visible );
        settings_->setValue( key + "size", layout.size );
        settings_->setValue( key + "x", layout.x );
        settings_->setValue( key + "y", layout.y );
    }
    static QJsonObject defaultGrid()
    { return QJsonObject{ { "lineThickness", 1.0 }, { "showOutline", true },
        { "outlineThickness", 2.0 }, { "cursorSize", 14.0 } }; }
    void updateInputTooltip()
    {
        setToolTip( arrowMode_
            ? QObject::tr( "Arrow-key control is active. Use Ctrl+Shift+M for mouse control." )
            : QObject::tr( "Mouse control is active. Click to capture the pointer; Escape releases it. Use Ctrl+Shift+A for arrow keys." ) );
    }
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
    FeedbackKind primary_;
    ElementLayout layers_[3];
    QJsonObject grid_;
    int gridColumns_, gridRows_;
    QString faceId_;
    QImage faceAtlas_;
    double faceRate_, faceX_, faceY_;
    int panelHeight_;
    int panelPercent_, stepPercent_;
    QWidget *referenceSurface_; // VLC owns the sibling central surface
    bool arrowMode_;
    bool ratingActive_;
    bool capturePending_;
    int cursorHideCalls_;
    std::function<void()> interrupted_;
    std::function<bool()> rateAllowed_;
    QElapsedTimer clock_;
    double pointy_[192], rounded_[192], phases_[16], amplitudes_[16];
};

#endif
