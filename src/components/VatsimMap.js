// Dependencies
import React, { Component, Fragment } from "react";
import { ScaleLoader } from "react-spinners";
import { Map, TileLayer } from "react-leaflet";
import Leaflet from "leaflet";
import MarkerClusterGroup from "react-leaflet-markercluster";
import Control from "react-leaflet-control";
import { ToastContainer, toast, Flip } from "react-toastify";
// import Metar from "metar";
import MetarParser from "metar-parser";

// Components & Constants
import Autocomplete from "./Autocomplete";
import { Markers } from "./Markers";
import ModalIcao from "./ModalIcao";
import ModalMetar from "./ModalMetar";
import {
  MAX_BOUNDS,
  ICAO_LETTERS_SUPPORTED,
  REFRESH_TIME
} from "../constants/constants";
import {
  getAirportData,
  getAirportName,
  getDecodedFlightRoute,
  getFirBoundaries,
  getMetarData,
  getVatsimData
} from "../services/api";

/*eslint-disable */
import setText from "leaflet-textpath";
/*eslint-disable */

const polyUtil = require("../../node_modules/polyline-encoded/Polyline.encoded.js");

export default class VatsimMap extends Component {
  state = {
    airport_name: "",
    callsign: "",
    controllers: [],
    ctr_controllers: [],
    destination_data: null,
    flights: [],
    height: 1000,
    icaos: null,
    icao_controllers: null,
    icao_destinations: null,
    icao_departures: null,
    isLoading: true,
    isModalMetarOpen: false,
    lat: 43.862,
    lng: -79.369,
    metar: null,
    metar_current_weather: null,
    metar_current_weather_title: null,
    selected_depairport: null,
    selected_destairport: null,
    selected_flight: null,
    selected_icao: null,
    selected_isDetailedFlightRoute: null,
    selected_isICAONorthAmerica: null,
    selected_metar_icao: null,
    selected_planned_route: null,
    width: 500,
    zoom: 2
  };

  clusterRef = React.createRef();
  flightRef = React.createRef();
  icaoRef = React.createRef();
  mapRef = React.createRef();
  metarRef = React.createRef();
  modalIcaoRef = React.createRef();
  modalMetarRef = React.createRef();
  unfollowBtnRef = React.createRef();

  interval = null;
  toastId = null;

  // Getters & Setters

  // Get the Current Zoom level. Update the position on the Map.
  getMapZoom = () => {
    if (this.map) {
      const { lat, lng } = this.map.getCenter();

      this.setState({
        lat,
        lng,
        zoom: this.map.getZoom()
      });
    }
  };

  // Get the current Viewport size.
  getViewportSize = () => {
    const width = Math.max(
      document.documentElement.clientWidth,
      window.innerWidth || 0
    );
    const height = Math.max(
      document.documentElement.clientHeight,
      window.innerHeight || 0
    );

    return { width, height };
  };

  // Leaflet map requires a Resize event in order to prevent any (literal) gray areas from being displayed.
  setResizeEvent = () => {
    window.addEventListener("resize", () => {
      setTimeout(() => {
        const { width, height } = this.getViewportSize();

        this.setState({ width, height });
      }, 500);
    });
  };

  // Every 30 seconds, execute calls to update all data on the Map.
  startInterval = () => {
    this.interval = setInterval(() => {
      this.getFlightData(() => {
        // If there is a Selected Flight, re-draw its position and FlightRoute, if any.
        if (this.state.selected_flight) {
          this.clearFlightRoute();

          if (this.state.selected_planned_route) {
            const latlngObject = {
              lat1: this.state.selected_flight.coordinates[0],
              lng1: this.state.selected_flight.coordinates[1],
              lat2: this.state.selected_planned_route[
                this.state.selected_planned_route.length - 1
              ][0],
              lng2: this.state.selected_planned_route[
                this.state.selected_planned_route.length - 1
              ][1]
            };

            if (
              !this.isPlaneOnGround(this.state.selected_flight.groundspeed) &&
              this.state.destination_data
            ) {
              this.drawFlightPath(
                this.state.selected_planned_route,
                latlngObject
              );
            } else {
              // If there's no flight path drawn on the screen, then simply centre the viewpoint over the Selected flight.
              this.viewNoRouteFlight([
                this.state.selected_flight.coordinates[0],
                this.state.selected_flight.coordinates[1]
              ]);

              this.applySelectedFlightData(this.state.selected_flight);
            }
          } else {
            // Fallback for the above code.
            this.viewNoRouteFlight([
              this.state.selected_flight.coordinates[0],
              this.state.selected_flight.coordinates[1]
            ]);
          }
        }

        this.drawFIRBoundaries();
      });
    }, REFRESH_TIME);
  };

  viewNoRouteFlight = coords => {
    const options = { animate: true, duration: 1.0, easeLinearity: 0.1 };
    this.map.setView(coords, this.zoom, options);
  };

  // Handlers & Functionality

  // Store Selected Flight Data in the State.
  applySelectedFlightData = flight => {
    this.setState(
      {
        callsign: flight.callsign,
        lat: flight.coordinates[0],
        lng: flight.coordinates[1],
        zoom: this.isPlaneOnGround(flight.groundspeed) ? 16 : this.state.zoom
      },
      () => {
        this.unfollowBtnRef.current.disabled = false;
      }
    );
  };

  // Clear all Flight Routes off of the Map.
  clearFlightRoute = () => {
    const layers = this.map._layers;

    for (let i in layers) {
      if (layers[i].options.class !== "fir" && layers[i]._path !== undefined) {
        try {
          this.map.removeLayer(layers[i]);
        } catch (e) {
          this.errorToastMsg("Could not draw the Flight Path.");
        }
      }
    }
  };

  // Chcek if FIR Boundary is currently drawn on the Map.
  checkFIRBoundary = icao => {
    const layers = this.map._layers;
    let isOnMap = false;

    for (let i in layers) {
      if (
        layers[i].options.class === "fir" &&
        layers[i].options.fir_id.includes(icao)
      ) {
        isOnMap = true;
        break;
      }
    }

    return isOnMap;
  };

  // Assign Lat/Lng values for Current Position and Arrival.
  drawFlightPath = (latlngs, startEndPoints, onInit) => {
    const { lat1, lng1, lat2, lng2 } = startEndPoints;

    // To prevent any bad data from going into the Polyline, check if the LatLng data is valid.
    if (!this.isValidLatLng([...latlngs])) return;

    // Use collected data to assemble the Polyline.
    const polyline = new Leaflet.polyline(latlngs, { color: "green" }).addTo(
      this.map
    );
    const oppDirectionHeading = this.getRadialOppDirection(
      lat1,
      lng1,
      lat2,
      lng2
    );
    const distanceLatLngs = [[lat1, lng1], [lat2, lng2]];
    const distanceKM = this.getDistanceToDestination(distanceLatLngs);
    const distanceNMI = this.getNauticalMilesFromKM(distanceKM);

    // Add 'Distance to Go' text to the Polyline in Kilometers.
    polyline.setText(`${distanceKM} KM to go (${distanceNMI} nmi)`, {
      attributes: { "font-weight": "bold", "font-size": "24" },
      center: true,
      offset:
        oppDirectionHeading &&
        (oppDirectionHeading >= 0 && oppDirectionHeading <= 180)
          ? 35
          : -15,
      orientation:
        oppDirectionHeading &&
        (oppDirectionHeading >= 180 && oppDirectionHeading <= 360)
          ? 0
          : "flip"
    });

    // Draw the line on the screen.
    this.setState({ isLoading: false }, () => {
      setTimeout(() => {
        if (onInit) {
          this.map.fitBounds(polyline.getBounds(), { padding: [50, 50] });
        }
      }, 0);
    });
  };

  drawFIRBoundaries = () => {
    // Find CTR/FSS Controllers so we can draw shaded area on the Map.
    const ctr_controllers = this.state.controllers.reduce((r, controller) => {
      if (
        controller.callsign.includes("FSS") ||
        controller.callsign.includes("FTW") ||
        controller.callsign.includes("CTR")
      ) {
        r.push(controller.callsign.replace("_CTR", ""));
      }
      return r;
    }, []);

    getFirBoundaries(ctr_controllers).then(fir_data => {
      const availableControllers = {};

      // Map the list of Available Controllers for referencing in the FIR Call below.
      for (let i = 0; i < ctr_controllers.length; i++) {
        availableControllers[ctr_controllers[i]] = this.state.controllers.find(
          controller => controller.callsign.includes(ctr_controllers[i])
        );
      }

      // Draw out active FIR Boundaries.
      for (let i = 0; i < fir_data.length; i++) {
        const { country, icao, points, region } = fir_data[i];

        // Prevent re-draws of FIR Boundaries to avoid FUAC on screen.
        if (!this.checkFIRBoundary(icao)) {
          const { callsign, name, frequency } = availableControllers[icao];

          new Leaflet.polygon(points, {
            color: "red",
            class: "fir",
            fir_id: callsign
          })
            .bindTooltip(
              `
                                <div><strong>${callsign}</strong></div>
                                <div>${name}</div>
                                ${region && `<div>${region}</div>`}
                                ${country && `<div>${country}</div>`}
                                <div>${frequency}</div>
                              `
            )
            .addTo(this.map);
        } else {
          // Find all existing FIRs on the map. Determine if they're in availableControllers. If they are not, remove them.
          const layers = this.map._layers;

          for (let j in layers) {
            if (layers[j].options.fir_id) {
              if (!layers[j].options.fir_id.includes(icao)) {
                this.map.removeLayer(layers[j]);
              }
            }
          }
        }
      }
    });

    this.setState({
      ctr_controllers,
      isLoading: false
    });
  };

  errorToastMsg = msg => {
    this.toastId = toast(msg, {
      autoClose: 5000,
      hideProgressBar: true,
      position: toast.POSITION.TOP_CENTER,
      type: toast.TYPE.ERROR
    });
  };

  // Get the necessary Flight Data to determine its Position, Destination, and Route (if available).
  findFlight = flight => {
    this.clearFlightRoute();

    Promise.all([
      getAirportData(flight.planned_destairport),
      getDecodedFlightRoute(
        flight.planned_depairport,
        flight.planned_route,
        flight.planned_destairport
      )
    ])
      .then(responses => {
        const destination_data = responses[0];
        const { encodedPolyline } = responses[1];

        if (destination_data) {
          const lat1 = flight.coordinates[0];
          const lng1 = flight.coordinates[1];

          let selected_planned_route = encodedPolyline
            ? polyUtil.decode(encodedPolyline)
            : null;
          let lat2 = null;
          let lng2 = null;
          let latlngObject = {};

          // selected_planned_route = selected_planned_route.map(points => {
          //   const [lat, lng] = points;
          //   console.log(lat, lng);

          //   let newPoints = [];

          //   if (lng < 0) {
          //     console.log("Convert:", lng);

          //     newPoints = [lat, L.Util.wrapNum(lng, [0, 360], true)];
          //     // newPoints = [lat, lng];
          //   } else {
          //     newPoints = [lat, lng];
          //   }

          //   console.log(...newPoints);

          //   return new L.LatLng(...newPoints);
          // });

          // console.log(selected_planned_route);

          // If the Flight Route returns nothing, or either of the ICAOs are not in North America, simply return the start and end points.
          // Otherwise, return the accepted LatLng data and store it as an Array in order to draw the Route on the Map.
          if (!encodedPolyline) {
            lat2 = parseFloat(destination_data.lat);
            lng2 = parseFloat(destination_data.lng);

            selected_planned_route = [[lat1, lng1], [lat2, lng2]];
          } else {
            lat2 = selected_planned_route[selected_planned_route.length - 1][0];
            lng2 = selected_planned_route[selected_planned_route.length - 1][1];
          }

          // Comprise Departure and Destination Latitudes and Longitudes to assist in drawing the Route on the Map.
          latlngObject = { lat1, lng1, lat2, lng2 };

          this.setState(
            {
              destination_data,
              selected_depairport: flight.planned_depairport,
              selected_destairport: flight.planned_destairport,
              selected_flight: flight,
              selected_planned_route
            },
            () => {
              if (!this.isPlaneOnGround(flight.groundspeed)) {
                this.drawFlightPath(selected_planned_route, latlngObject, true);
              }

              this.setState({ isLoading: false }, () => {
                this.applySelectedFlightData(flight);
              });
            }
          );
        } else {
          this.setState(
            {
              destination_data: null,
              isLoading: false,
              selected_flight: flight,
              selected_depairport: null,
              selected_destairport: null,
              selected_planned_route: null,
              zoom: 10
            },
            () => {
              this.applySelectedFlightData(flight);
              this.viewNoRouteFlight([
                flight.coordinates[0],
                flight.coordinates[1]
              ]);
            }
          );
        }
      })
      .catch(err => {
        this.setState(
          {
            destination_data: null,
            isLoading: false,
            selected_flight: flight,
            selected_depairport: null,
            selected_destairport: null,
            selected_planned_route: null,
            zoom: 10
          },
          () => {
            this.applySelectedFlightData(flight);
            this.viewNoRouteFlight([
              flight.coordinates[0],
              flight.coordinates[1]
            ]);
          }
        );
      });
  };

  // Get the Airport Data that is required to find it on the Map.
  getAirportPosition = icao => {
    getAirportData(icao).then(data => {
      if (!data.lat || !data.lng) {
        this.serverToastMsg(
          "Sorry. We can't find this ICAO. Please try again",
          true
        );
      } else {
        this.setState(
          {
            isLoading: true,
            lat: parseFloat(data.lat),
            lng: parseFloat(data.lng),
            zoom: 13
          },
          () => {
            this.setState({
              isLoading: false
            });
          }
        );
      }
    });
  };

  getDeg2rad = deg => {
    return deg * (Math.PI / 180);
  };

  // Get Radial Opposite Direction from Destination to Current Position.
  getRadialOppDirection = (lat1, lng1, lat2, lng2) => {
    const _lat1 = this.getDeg2rad(lat1);
    const _lat2 = this.getDeg2rad(lat2);
    const dLng = this.getDeg2rad(lng2 - lng1);

    const x =
      Math.cos(_lat1) * Math.sin(_lat2) -
      Math.sin(_lat1) * Math.cos(_lat2) * Math.cos(dLng);
    const y = Math.sin(dLng) * Math.cos(_lat2);

    const brng = Math.atan2(y, x);

    let res = ((brng * 180) / Math.PI + 360) % 360;

    return res <= 180 ? res + 180 : res - 180;
  };

  // Calculate the Distance between the Current Position and the Destination in Kilometres.
  getDistanceToDestination = latlngs => {
    try {
      const flight_coords_lat = latlngs[0][0];
      const flight_coords_lng = latlngs[0][1];
      const airport_coords_lat = parseFloat(latlngs[1][0]);
      const airport_coords_lng = parseFloat(latlngs[1][1]);

      const R = 6371; // Radius of the earth in km
      const dLat = this.getDeg2rad(airport_coords_lat - flight_coords_lat);
      const dLon = this.getDeg2rad(airport_coords_lng - flight_coords_lng);
      const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(this.getDeg2rad(flight_coords_lat)) *
          Math.cos(this.getDeg2rad(airport_coords_lat)) *
          Math.sin(dLon / 2) *
          Math.sin(dLon / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      const d = R * c; // Distance in km

      return Math.round(d);
    } catch (err) {
      return null;
    }
  };

  getFlightData = callback => {
    // Collect the latest VATSIM Data.
    getVatsimData().then(data => {
      if (!data) {
        this.setState(
          {
            controllers: [],
            flights: [],
            icaos: [],
            isLoading: false
          },
          () => {
            this.serverToastMsg("No connection.", false);
          }
        );

        return;
      } else if (Object.keys(data).length === 0) {
        return;
      }

      // Declare the data vars if there's new data.
      let { flights, controllers, icaos } = data;

      // To prevent a FUAC. re-draw the Planes on the screen with the same data if no new data has downloaded.
      if (Object.keys(data).length === 0) {
        flights = this.state.flights;
        controllers = this.state.flights;
        icaos = this.state.flights;
      }

      // Depending if there were any environment issues or changes, display the 'Connected' Toast Pop-up.
      if (toast.isActive(this.toastId)) this.serverToastMsg("Connected.", true);

      // Update State with User Data.
      this.setState({ flights, controllers, icaos }, () => {
        // Pass the Selected ICAO to the Modal Data if it's open to feed it persistant data.
        if (
          this.modalIcaoRef.current.state.isModalOpen &&
          this.modalIcaoRef.current.state.icao
        ) {
          this.modalData(this.state.selected_icao);
        }

        // Update the Selected Flight's data and apply it to the Map.
        if (this.state.selected_flight) {
          const selected_flight = this.state.flights.find(flight => {
            return (
              flight.callsign.toUpperCase() ===
              this.state.selected_flight.callsign.toUpperCase()
            );
          });

          this.setState({ selected_flight }, () =>
            callback ? callback() : null
          );
        } else {
          this.handleUnfollow();

          if (callback) callback();
        }
      });
    });
  };

  getNauticalMilesFromKM = km => {
    return Math.round(km * 0.5399568);
  };

  handleEnterKey = e => {
    if (e.key === "Enter") this.searchFlight();
  };

  handleReset = () => {
    this.setState(
      {
        callsign: "",
        destination_data: null,
        lat: 43.862,
        lng: -79.369,
        isLoading: false,
        selected_depairport: null,
        selected_destairport: null,
        selected_flight: null,
        selected_icao: null,
        selected_isDetailedFlightRoute: null,
        selected_isICAONorthAmerica: null,
        selected_metar_icao: null,
        selected_planned_route: null,
        zoom: 2
      },
      () => {
        // Clear Progress Line, Popups, and Inputs.
        this.clearFlightRoute();
        this.flightRef.current.inputRef.current.value = "";
        this.icaoRef.current.inputRef.current.value = "";
        this.metarRef.current.value = "";
      }
    );
  };

  handleUnfollow = () => {
    this.setState(
      {
        callsign: "",
        destination_data: null,
        selected_depairport: null,
        selected_destairport: null,
        selected_flight: null,
        selected_icao: null,
        selected_isDetailedFlightRoute: null,
        selected_isICAONorthAmerica: null,
        selected_metar_icao: null,
        selected_planned_route: null
      },
      () => {
        // Clear Progress Line, Popups, and Inputs.
        this.clearFlightRoute();
        this.flightRef.current.inputRef.current.value;
      }
    );
  };

  isPlaneOnGround = groundspeed => {
    return groundspeed <= 80;
  };

  isICAONorthAmerica = icao => {
    return ICAO_LETTERS_SUPPORTED.includes(icao.charAt(0));
  };

  isValidLatLng = latlng => {
    let i = 0;
    let isValid = true;
    const iMax = latlng.length;

    for (; i < iMax; i++) {
      if (Number.isNaN(latlng[i][0]) || Number.isNaN(latlng[i][1])) {
        isValid = false;
      }

      if (!isValid) return false;
    }

    return true;
  };

  openIcaoModal = selected_icao => {
    this.setState({ isLoading: true, selected_icao }, () => {
      this.modalData(selected_icao);
    });
  };

  modalData = selected_icao => {
    Promise.all([
      getAirportName(selected_icao),
      getAirportData(selected_icao)
    ]).then(responses => {
      const airport_name = responses[0];
      const icao_data = responses[1];

      if (this.state.icaos.includes(selected_icao)) {
        const icao_departures = this.state.flights.filter(
          flight => selected_icao === flight.planned_depairport
        );
        const icao_destinations = this.state.flights.filter(
          flight => selected_icao === flight.planned_destairport
        );
        const icao_controllers = this.state.controllers.filter(controller => {
          const icao_str = controller.callsign.substr(
            0,
            controller.callsign.indexOf("_")
          );

          if (icao_str.length >= 3 && selected_icao.includes(icao_str)) {
            return selected_icao.includes(icao_str);
          }
        });

        // Get the Distance remaining in any active flights.
        for (let i = 0; i < icao_destinations.length; i++) {
          icao_destinations[i][
            "distanceToGo"
          ] = `${this.getDistanceToDestination([
            [
              icao_destinations[i]["coordinates"][0],
              icao_destinations[i]["coordinates"][1]
            ],
            [icao_data.lat, icao_data.lng]
          ])} km`;
        }

        this.setState(
          {
            airport_name,
            icao_controllers,
            icao_departures,
            icao_destinations,
            isLoading: false
          },
          () => {
            if (!this.modalIcaoRef.current.state.isModalOpen)
              this.modalIcaoRef.current.toggleModal();
          }
        );
      } else {
        this.setState(
          {
            isLoading: false
          },
          () => {
            this.errorToastMsg("This ICAO is not listed.");
          }
        );
      }
    });
  };

  openMetarModal = selected_metar => {
    this.setState({ isLoading: true }, () => {
      Promise.all([
        getAirportName(selected_metar),
        getMetarData(selected_metar)
      ]).then(responses => {
        const [airport_name, metar_response] = responses;

        if (metar_response) {
          // const metar = Metar(metar_response);
          const metar = MetarParser(metar_response);

          const [
            metar_current_weather,
            metar_current_weather_title
          ] = this.getWeather(metar);

          this.setState(
            {
              airport_name,
              isLoading: false,
              metar,
              metar_current_weather,
              metar_current_weather_title,
              selected_metar_icao: selected_metar
            },
            () => {
              this.modalMetarRef.current.toggleModal();
            }
          );
        } else {
          this.setState({ isLoading: false }, () => {
            this.errorToastMsg("There is no METAR for this ICAO.");
          });
        }
      });
    });
  };

  getWeather = metar => {
    const { clouds, weather } = metar;

    let metar_current_weather = "";
    let metar_current_weather_title = "";

    if (weather.length > 0) {
      const weatherObj = weather[0];

      // Get the Precipitation first. If there is none, then get the Obscuration if it is available.
      if (weatherObj.precipitation) {
        metar_current_weather = this.getWeatherIcon(weatherObj.precipitation);
      } else if (weatherObj.obscuration) {
        metar_current_weather = this.getWeatherIcon(weatherObj.obscuration);
      }
    }

    console.log(metar);

    console.log(metar_current_weather);

    // Update the readable title.
    metar_current_weather_title = metar_current_weather
      .replace("wi-", "")
      .split(" ")[0];

    // Determine English result for Tooltip.
    // if (metar_current_weather_title.includes("na")) {
    //   metar_current_weather_title = "N/A";
    // } else {
    //   metar_current_weather_title =
    //     metar_current_weather_title[0].toUpperCase() +
    //     metar_current_weather_title.slice(1);
    // }

    return [metar_current_weather, metar_current_weather_title];
  };

  getWeatherIcon = icon => {
    switch (icon) {
      case "clear-night":
        return "wi-night-clear";
      case "few":
        return "wi-cloudy";
      case "scattered":
      case "broken":
        return "wi-sunny-overcast";
      case "cloudy":
      case "overcast":
        return "wi-cloudy";
      case "fog":
      case "mist":
        return "wi-fog";
      case "rain":
      case "drizzle":
        return "wi-rain";
      case "wind":
        return "wi-windy";
      case "snow":
        return "wi-snow";
      case "clear-day":
        return "wi-sunny";
      case "partly-cloudy-night":
        return "wi-night-partly-cloudy";
      default:
        return "wi-na";
    }
  };

  searchFlight = () => {
    const callsign = document.getElementsByName("flightSearch")[0].value;

    this.updateCallsign(callsign);
  };

  serverToastMsg = (msg, isConnected) => {
    if (!toast.isActive(this.toastId)) {
      this.toastId = toast(msg, {
        autoClose: isConnected ? 5000 : false,
        hideProgressBar: true,
        position: toast.POSITION.TOP_CENTER,
        type: isConnected ? toast.TYPE.SUCCESS : toast.TYPE.ERROR
      });
    } else {
      toast.update(this.toastId, {
        autoClose: isConnected ? 5000 : false,
        hideProgressBar: true,
        position: toast.POSITION.TOP_CENTER,
        render: msg,
        transition: Flip,
        type: isConnected ? toast.TYPE.SUCCESS : toast.TYPE.ERROR
      });
    }
  };

  updateCallsign = callsign => {
    if (this.state.flights.length > 0) {
      const flight = this.state.flights.find(flight => {
        return flight.callsign.toUpperCase() === callsign.toUpperCase();
      });

      if (flight) {
        this.setState({ isLoading: true, callsign }, () => {
          this.findFlight(flight);
        });
      } else {
        this.errorToastMsg(`${callsign} does not exist.`);
      }
    }
  };

  // React Lifecycle Hooks

  componentDidMount = () => {
    const { width, height } = this.getViewportSize();

    this.map = this.mapRef.current.leafletElement;

    setTimeout(() => {
      this.setState({ width, height }, () => {
        if (!this.interval) {
          this.setResizeEvent();
          this.startInterval();
          this.getFlightData(() => {
            this.drawFIRBoundaries();
          });
          window.dispatchEvent(new Event("resize"));
        }
      });
    }, 0);
  };

  createClusterCustomIcon = cluster => {
    const childCount = cluster.getChildCount();
    let markerClusterClass = "marker-cluster-";

    if (childCount < 10) {
      markerClusterClass += "small";
    } else if (childCount < 100) {
      markerClusterClass += "medium";
    } else {
      markerClusterClass += "large";
    }

    if (this.state.selected_flight) {
      const selectedMarkerInCluster = cluster.getAllChildMarkers().find(x => {
        return x.options.icon.options.selected;
      });

      // Return found Marker and then return divIcon below.
      if (selectedMarkerInCluster) {
        return L.divIcon({
          html: `<span>${childCount}</span>`,
          className: "marker-cluster-custom",
          iconSize: L.point(40, 40, true)
        });
      }
    }

    return L.divIcon({
      html: `<div><span>${childCount}</span></div>`,
      className: `marker-cluster ${markerClusterClass}`,
      iconSize: L.point(40, 40, true)
    });
  };

  render = () => {
    return (
      <Fragment>
        <div
          className={
            "loading-spinner " + (this.state.isLoading ? null : "--hide-loader")
          }
        >
          <ScaleLoader color={"#123abc"} loading={this.state.isLoading} />
        </div>
        <ToastContainer />
        <ModalIcao
          airport_name={this.state.airport_name}
          icao={this.state.selected_icao}
          items={[
            this.state.icao_departures,
            this.state.icao_destinations,
            this.state.icao_controllers
          ]}
          returnData={callsign => this.updateCallsign(callsign)}
          ref={this.modalIcaoRef}
          returnICAO={e => this.getAirportPosition(e)}
        />
        <ModalMetar
          airport_name={this.state.airport_name}
          icao={this.state.selected_metar_icao}
          metar={this.state.metar}
          metar_current_weather={this.state.metar_current_weather}
          metar_current_weather_title={this.state.metar_current_weather_title}
          ref={this.modalMetarRef}
          returnICAO={e => this.getAirportPosition(e)}
          toggleModal={this.state.isModalMetarOpen}
        />
        <Map
          center={[this.state.lat, this.state.lng]}
          maxBounds={MAX_BOUNDS}
          onZoomEnd={this.getMapZoom.bind(this)}
          ref={this.mapRef}
          style={{
            height: this.state.height,
            width: this.state.width
          }}
          zoom={this.state.zoom}
        >
          <TileLayer
            crossOrigin={true}
            saveToCache={true}
            url="https://c.tile.openstreetmap.de/{z}/{x}/{y}.png"
            useCache={true}
          />
          <MarkerClusterGroup
            chunkedLoading={true}
            disableClusteringAtZoom="7"
            maxClusterRadius="35"
            ref={this.clusterRef}
            showCoverageOnHover={false}
            spiderfyOnMaxZoom={false}
            iconCreateFunction={this.createClusterCustomIcon}
          >
            <Markers
              flights={this.state.flights}
              selectedFlight={this.state.selected_flight}
              updateCallsign={this.updateCallsign.bind(this)}
            />
          </MarkerClusterGroup>
          <Control position="topleft">
            <Fragment>
              <div>
                <button onClick={this.handleReset.bind(this)}>
                  Reset View
                </button>
                <button
                  ref={this.unfollowBtnRef}
                  onClick={this.handleUnfollow.bind(this)}
                >
                  Unfollow
                </button>
              </div>
              <Autocomplete
                items={this.state.flights}
                onSelect={callsign => this.updateCallsign(callsign)}
                placeholder="Search for the callsign..."
                ref={this.flightRef}
                searchCompareValue="callsign"
              />
              <Autocomplete
                items={this.state.icaos}
                onSelect={icao => this.openIcaoModal(icao)}
                placeholder="Search for the ICAO..."
                ref={this.icaoRef}
                searchCompareValue="planned_destairport"
              />
              <input
                onKeyPress={event => {
                  if (event.key === "Enter")
                    this.openMetarModal(event.target.value);
                }}
                name="metar"
                ref={this.metarRef}
                placeholder="Search for the METAR..."
                type="search"
              />
            </Fragment>
          </Control>
        </Map>
      </Fragment>
    );
  };
}
