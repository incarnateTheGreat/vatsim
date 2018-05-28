import React, { Component } from 'react';
import { isMobile } from 'react-device-detect';
import axios from 'axios';
import classNames from 'classnames';
import {
  ComposableMap,
  ZoomableGroup,
  Geographies,
  Geography,
  Markers,
  Marker
} from "react-simple-maps";
import { Motion, spring } from "react-motion";
import mapFile from '../maps/world-50m';
import { CLIENT_LABELS, PLANE_SVG_PTH, CITIES } from '../constants/constants';

// import { geoPath } from "d3-geo"

const wrapperStyles = {
  width: "100%",
  margin: "0 auto",
}

export default class Map extends Component {
  constructor() {
    super();

    this.state = {
      center: [0, 0],
      zoom: 1,
      flights: [],
      selectedFlight: '',
      callsign: ''
    };

    this.interval = null;
    this.handleZoomIn = this.handleZoomIn.bind(this)
    this.handleZoomOut = this.handleZoomOut.bind(this)
    this.handleFlightClick = this.handleFlightClick.bind(this)
    this.handleReset = this.handleReset.bind(this)
    this.findFlight = this.findFlight.bind(this)
    this.handleCitySelection = this.handleCitySelection.bind(this)
    this.flightCallsignSearch = this.flightCallsignSearch.bind(this)
  }

  handleZoomIn() {
    this.setState({
      zoom: this.state.zoom * 3
    })
  }

  handleZoomOut() {
    if (this.state.zoom > 1) {
      this.setState({
        zoom: this.state.zoom / 2,
      })
    }
  }

  handleFlightClick(flight, isCity) {
    console.log(flight);

    if (isCity) {
      this.setState({
        center: flight.coordinates,
        zoom: this.state.zoom === 1 ? 50 : this.state.zoom
      })
    } else {
      this.setState({
        callsign: flight.callsign,
        center: flight.coordinates,
        selectedFlight: flight,
        zoom: this.state.zoom === 1 ? 50 : this.state.zoom
      })
    }
  }

  handleCitySelection(selectedCity) {
    const city = CITIES.find(e => e.name === selectedCity.target.value);

    this.handleFlightClick(city, true);
  }

  handleReset() {
    this.setState({
      center: [0, 0],
      selectedFlight: '',
      zoom: 1
    })
  }

  cityDropdown() {
    const citySelecitons = [];

    for (let x in CITIES) {
      citySelecitons.push(<option key={CITIES[x].name} value={CITIES[x].name}>{CITIES[x].name}</option>)
    }

    // Sort alphabetically.
    citySelecitons.sort((a, b) => {
      const nameA = a.props.value.toUpperCase(),
            nameB = b.props.value.toUpperCase();

      if (nameA < nameB) {
        return -1;
      }

      if (nameA > nameB) {
        return 1;
      }

      return 0;
    })

    return citySelecitons;
  }

  findFlight() {
    if (this.state.flights.length > 0) {
      const flight = this.state.flights.find(flight => {
        return flight.callsign.toUpperCase() === this.state.callsign.toUpperCase()
      })

      if (flight) this.handleFlightClick(flight);
    }
  }

  flightCallsignSearch(e) {
    this.setState({ callsign: e.target.value });
  }

  async getData() {
    return await axios('http://localhost:8000/api/vatsim-data')
      .then(res => res.data);
  }

  getFlightData() {
    let flightDataArr = [];

    this.getData().then(data => {
      for (let i = 0; i < data.length; i++) {
        let clientInterface = {},
            clientDataSplit = data[i].split(':');

        for (let j = 0; j < CLIENT_LABELS.length; j++) {
          clientInterface[CLIENT_LABELS[j]] = clientDataSplit[j];
        }

        if (!this.checkFlightPosition(clientInterface)) {
          flightDataArr.push({
            name: clientInterface.realname,
            callsign: clientInterface.callsign,
            coordinates: [parseFloat(clientInterface.longitude), parseFloat(clientInterface.latitude)],
            frequency: clientInterface.frequency,
            altitude: clientInterface.altitude,
            planned_aircraft: clientInterface.planned_aircraft,
            heading: clientInterface.heading,
            groundspeed: clientInterface.groundspeed,
            planned_depairport: clientInterface.planned_depairport,
            planned_destairport: clientInterface.planned_destairport
          })
        }
      }

      this.setState({ flights: flightDataArr });
    })
  }

  startInterval() {
		this.interval = setInterval(() => {
			this.getFlightData();
		}, 60000);
	}

  checkFlightPosition(clientInterface) {
    return ((isNaN(clientInterface.longitude) || clientInterface.longitude === '') ||
            (isNaN(clientInterface.latitude) || clientInterface.latitude === ''));
  }

  assignPlaneClass(marker) {
    let selectedFlightClass = null;

    if (marker.callsign === this.state.selectedFlight.callsign) {
      selectedFlightClass = classNames(
        'plane',
        '--selected'
      );
    } else {
      selectedFlightClass = classNames(
        'plane'
      );
    }

    return selectedFlightClass;
  }

  componentDidMount() {
    if (!this.interval) {
      this.startInterval();
      this.getFlightData();
    }
  }

  // projection() {
  //   return geoTimes()
  //     .translate([this.props.width/2, this.props.height/2])
  //     .scale(160)
  // }

  // thing(geo) {
  //   const geoArr = geo.geometry.coordinates[0],
  //         currentCoordinates = geoArr[0][geoArr.length - 1];
  // }

  render() {
    let selectedFlightClass = null;

    return (
      <div style={wrapperStyles}>
        <button onClick={this.handleZoomIn}>
          { "Zoom in" }
        </button>
        <button onClick={this.handleZoomOut}>
          { "Zoom out" }
        </button>
        <button onClick={this.handleReset}>
          { "Reset" }
        </button>
        <input
          type="text"
          placeholder="Search for the callsign..."
          onChange={this.flightCallsignSearch} />
        <input
          type="button"
          value="Search"
          onClick={this.findFlight}
        />
        <label htmlFor="city-picker__select">City:</label>
        <select name='city-picker__select' id='city-picker__select' onChange={this.handleCitySelection}>
          {this.cityDropdown()}
        </select>
        <Motion
          defaultStyle={{
            zoom: 1,
            x: 0,
            y: 20,
          }}
          style={{
            zoom: spring(this.state.zoom, {stiffness: 180, damping: 20}),
            x: spring(this.state.center[0], {stiffness: 100, damping: 20}),
            y: spring(this.state.center[1], {stiffness: 100, damping: 20}),
          }}
          >
          {({zoom,x,y}) => (
              <ComposableMap
                projectionConfig={{ scale: 250 }}
                width={980}
                height={800}
                style={{
                  width: "100%",
                  height: "auto",
                }}
                >
                <ZoomableGroup center={[x,y]} zoom={zoom}>
                  <Geographies geography={mapFile}>
                    {(geographies, projection) =>
                      geographies.map((geography, i) => (
                        <Geography
                          key={i}
                          geography={geography}
                          projection={projection}
                          disableoptimization="true"
                          style={{
                            default: {
                              fill: "#ECEFF1",
                              stroke: "#607D8B",
                              strokeWidth: 0.75,
                              outline: "none",
                            },
                            hover: {
                              fill: "#ECEFF1",
                              stroke: "#607D8B",
                              strokeWidth: 0.75,
                              outline: "none",
                            },
                            pressed: {
                              fill: "#ECEFF1",
                              stroke: "#607D8B",
                              strokeWidth: 0.75,
                              outline: "none",
                            },
                          }}
                        />
                    ))}
                  </Geographies>
                  <Markers>
                    {this.state.flights.map((marker, i) => {
                      selectedFlightClass = this.assignPlaneClass(marker);

                      return (
                        <Marker
                          key={i}
                          marker={marker}
                          onClick={(e) => this.handleFlightClick(e)}
                          rotate={marker.heading}
                          defaultZoomNumerator={isMobile ? "0.50" : "0.35"}>
                          <path
                            className={selectedFlightClass}
                            d={PLANE_SVG_PTH}
                            strokeWidth="0"
                            fill="#73b6e6" />
                        </Marker>
                      )
                    })}
                  </Markers>
                </ZoomableGroup>
              </ComposableMap>
            )}
        </Motion>
      </div>
    )
  }
}