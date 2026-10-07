#include "flubber_panel.hpp"
#include "flubber_bridge.hpp"
#include <QApplication>
#include <QImage>
#include <QTemporaryDir>
#include <QFile>
#include <QEventLoop>
#include <QTimer>
#include <QSpinBox>
#include <QVBoxLayout>
#include <cstdio>

int main( int argc, char **argv )
{
    QApplication app( argc, argv );
    if( argc != 3 ) return 2;
    QJsonObject appearance;
    QString error;
    if( !FlubberPanel::readAppearance( QString::fromLocal8Bit( argv[1] ), appearance, error ) )
    {
        std::fprintf( stderr, "Valid appearance rejected: %s\n", error.toUtf8().constData() );
        return 3;
    }
    QTemporaryDir temp;
    QSettings settings( temp.filePath( "flubber.ini" ), QSettings::IniFormat );
    settings.setValue( "Flubber/appearancePath", QString::fromLocal8Bit( argv[1] ) );
    FlubberPanel panel( &settings );
    panel.resize( 640, panel.height() );
    panel.show();
    app.processEvents();
    QImage image = panel.grab().toImage();
    if( image.isNull() || image.pixelColor( 0, 0 ) != QColor( Qt::black ) ) return 4;
    if( !image.save( QString::fromLocal8Bit( argv[2] ) ) ) return 5;
    QFile original( QString::fromLocal8Bit( argv[1] ) );
    if( !original.open( QIODevice::ReadOnly ) ) return 6;
    QByteArray duplicate = original.readAll();
    duplicate.insert( duplicate.indexOf( '{' ) + 1, "\"\\u0073chema\":\"hidden-duplicate\"," );
    QFile bad( temp.filePath( "duplicate.json" ) );
    if( !bad.open( QIODevice::WriteOnly ) ) return 7;
    bad.write( duplicate ); bad.close();
    if( FlubberPanel::readAppearance( bad.fileName(), appearance, error ) || !error.contains( "duplicate" ) ) return 8;
    QJsonObject colors = appearance.value( "visual" ).toObject().value( "colors" ).toObject();
    colors.insert( "idle", "#ff0000" );
    colors.insert( "cursor", "#00ff00" );
    QJsonObject visual = appearance.value( "visual" ).toObject();
    visual.insert( "colors", colors );
    visual.insert( "transparency", 0 );
    appearance.insert( "visual", visual );
    QFile red( temp.filePath( "red.json" ) );
    if( !red.open( QIODevice::WriteOnly ) ) return 9;
    red.write( QJsonDocument( appearance ).toJson() ); red.close();
    settings.setValue( "Flubber/appearancePath", red.fileName() );
    FlubberPanel redPanel( &settings );
    redPanel.resize( 640, redPanel.height() ); redPanel.show(); app.processEvents();
    const QImage redImage = redPanel.grab().toImage();
    if( redImage.pixelColor( 320, 65 ) != QColor( "#ff0000" ) ) return 10;
    visual.insert( "transparency", 1 );
    appearance.insert( "visual", visual );
    QFile transparent( temp.filePath( "transparent.json" ) );
    if( !transparent.open( QIODevice::WriteOnly ) ) return 11;
    transparent.write( QJsonDocument( appearance ).toJson() ); transparent.close();
    settings.setValue( "Flubber/appearancePath", transparent.fileName() );
    FlubberPanel clearPanel( &settings );
    clearPanel.resize( 640, clearPanel.height() ); clearPanel.show(); app.processEvents();
    if( clearPanel.grab().toImage().pixelColor( 320, 65 ) != QColor( Qt::black ) ) return 12;
    QTimer::singleShot( 0, &app, [&]() {
        QDialog *dialog = qobject_cast<QDialog *>( QApplication::activeModalWidget() );
        if( !dialog ) { std::fprintf( stderr, "No modal dialog\n" ); return; }
        QSpinBox *height = dialog->findChild<QSpinBox *>( "flubber-panel-height" );
        QSpinBox *size = dialog->findChild<QSpinBox *>( "flubber-layer-0-size" );
        QSpinBox *x = dialog->findChild<QSpinBox *>( "flubber-layer-0-x" );
        QSpinBox *y = dialog->findChild<QSpinBox *>( "flubber-layer-0-y" );
        if( !height || !size || !x || !y ) { dialog->reject(); return; }
        height->setValue( 200 ); size->setValue( 80 );
        x->setValue( 25 ); y->setValue( 75 );
        dialog->accept();
    } );
    panel.showControls( NULL );
    if( settings.value( "Flubber/panelHeight" ).toInt() != 200 ||
        settings.value( "Flubber/layers/flubber/size" ).toInt() != 80 ||
        settings.value( "Flubber/layers/flubber/x" ).toInt() != 25 ||
        settings.value( "Flubber/layers/flubber/y" ).toInt() != 75 ) return 13;
    qputenv( "VLC_FLUBBER_STEP_PERCENT", "20" );
    const auto ratioCheck = [&]( const char *ratio, int expected ) {
        qputenv( "VLC_FLUBBER_PANEL_PERCENT", ratio );
        QWidget container;
        QVBoxLayout layout( &container );
        layout.setContentsMargins( 0, 0, 0, 0 ); layout.setSpacing( 0 );
        QWidget reference;
        FlubberPanel sessionPanel( &settings, &container );
        sessionPanel.setReferenceSurface( &reference );
        layout.addWidget( &reference, 1 );
        layout.addWidget( &sessionPanel );
        container.resize( 640, 800 ); container.show();
        QEventLoop loop;
        QTimer::singleShot( 160, &loop, &QEventLoop::quit );
        loop.exec();
        if( sessionPanel.height() != expected ) return false;
        QKeyEvent right( QEvent::KeyPress, Qt::Key_Right, Qt::NoModifier );
        QApplication::sendEvent( &sessionPanel, &right );
        if( !qFuzzyCompare( sessionPanel.valence() + 1.f, 1.f ) ) return false;
        sessionPanel.setRateAllowedHandler( []() { return true; } );
        sessionPanel.setArrowMode( true );
        if( !sessionPanel.handleArrowKey( &right ) ||
            !qFuzzyCompare( sessionPanel.valence() + 1.f, 1.2f ) ) return false;
        sessionPanel.setVideoAffect( -.8, -.8 );
        if( !qFuzzyCompare( sessionPanel.valence() + 1.f, 1.2f ) ) return false;
        QKeyEvent modified( QEvent::KeyPress, Qt::Key_Right, Qt::ControlModifier );
        if( sessionPanel.handleArrowKey( &modified ) ) return false;
        sessionPanel.setArrowMode( false );
        if( sessionPanel.handleArrowKey( &right ) ) return false;
        sessionPanel.setVideoAffect( -.5, .5 );
        return qFuzzyCompare( sessionPanel.valence() + 1.f, .5f ) &&
               qFuzzyCompare( sessionPanel.arousal() + 1.f, 1.5f ) &&
               settings.value( "Flubber/inputMode" ).toString() == QLatin1String( "mouse" );
    };
    if( !ratioCheck( "100", 400 ) || !ratioCheck( "10", 73 ) ) return 14;
    if( settings.value( "Flubber/panelHeight" ).toInt() != 200 ) return 15;
    panel.setLayout( FlubberPanel::GridKind, { true, 45, 18, 50 } );
    panel.setLayout( FlubberPanel::FaceKind, { true, 45, 82, 50 } );
    panel.setPrimary( FlubberPanel::GridKind );
    if( panel.primary() != FlubberPanel::GridKind || !panel.visible( FlubberPanel::FaceKind ) ||
        !panel.visible( FlubberPanel::FlubberKind ) ) return 16;
    QString faceError;
    if( !panel.setFaceId( "photo-synthetic-01", &faceError ) ) return 17;
    panel.resize( 900, panel.height() ); app.processEvents();
    const QImage three = panel.grab().toImage();
    three.save( QFileInfo( QString::fromLocal8Bit( argv[2] ) ).dir().filePath( "three-layers.png" ) );
    if( three.pixelColor( 0, 0 ) != QColor( Qt::black ) ||
        three.pixelColor( 162, 100 ) == QColor( Qt::black ) ||
        three.pixelColor( 738, 100 ) == QColor( Qt::black ) ) return 18;
    const QString fullSettings = temp.filePath( "full-settings.json" );
    if( !panel.saveSettingsFile( fullSettings, error ) ) return 19;
    FlubberPanel restored( &settings );
    if( !restored.loadSettingsFile( fullSettings, error ) ||
        restored.primary() != FlubberPanel::GridKind ||
        restored.faceId() != QLatin1String( "photo-synthetic-01" ) ||
        !restored.visible( FlubberPanel::FaceKind ) ) return 20;
    QJsonObject invalid = panel.settingsJson(); invalid.insert( "primary", "unknown" );
    QFile invalidFile( temp.filePath( "invalid-settings.json" ) );
    if( !invalidFile.open( QIODevice::WriteOnly ) ) return 21;
    invalidFile.write( QJsonDocument( invalid ).toJson() ); invalidFile.close();
    if( restored.loadSettingsFile( invalidFile.fileName(), error ) ||
        restored.primary() != FlubberPanel::GridKind ) return 22;
    qunsetenv( "VLC_FLUBBER_PANEL_PERCENT" );
    qunsetenv( "VLC_FLUBBER_STEP_PERCENT" );
    return 0;
}
