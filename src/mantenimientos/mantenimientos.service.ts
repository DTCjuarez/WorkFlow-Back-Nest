import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { PrograMantenimientoDto } from './dto/create-mantenimiento.dto';
import {
  Mantenimiento,
  MantenimientoDocument,
} from './schemas/mantenimiento.schema';
import { CarsService } from 'src/cars/cars.service';
import { ExistsCarDto } from '../cars/dto/exists-card.dto';
import { UpdateMantenimientoDto } from './dto/update-mantenimiento.dto';
import { UpdateOneMantenimientoDto } from './dto/update-one-mantenimiento.dto';
import { RepuestosService } from 'src/repuestos/repuestos.service';
import { VerifyRepuestoDto } from '../repuestos/dto/verify-repuesto.dto';
import { CarInfoDto } from 'src/cars/dto/car-info.dto';
import { Subject } from 'rxjs';
import * as moment from 'moment-timezone';
import { pubSub } from 'src/shared/pubsub';
import { CreateRepuestoAjusteDto } from './dto/create-repuesto-ajuste.dto';
import { KmRecorridoPorMes } from './dto/km-recorrido-mes.dto';
import { Costos } from './dto/costos-mes-prev-correc.dto';
import { RepuestosMasConsumidosPorMes } from './dto/costo-repuesto-mes.dto';
import { OperatividadPorMes } from './dto/operatividad-mes.dto';
import { CalendarGrafica } from './dto/calendar-graph.dt';
import {
  DashRepuestos,
  ProductoConsumidoDash,
} from 'src/estadisticas/dto/dashboard.dto';
import { NotificacionesService } from 'src/notificaciones/notificaciones.service';
import { RepuestoDto } from 'src/repuestos/dto/repuesto.dto';

@Injectable()
export class MantenimientosService {
  private readonly mantenimientoChanges = new Subject<any>();
  constructor(
    @InjectModel(Mantenimiento.name)
    private readonly mantenimientoModel: Model<Mantenimiento>,
    private readonly carsService: CarsService,
    private readonly repuestosService: RepuestosService,
    private readonly notificacionesService: NotificacionesService,
  ) {}

  async getMantenimientosPorPlaca(placa: string): Promise<Mantenimiento[]> {
    return this.mantenimientoModel.find({ placa: placa }).exec();
  }

  async getCantidadMantenimientosPorEstado(estado: string): Promise<number> {
    return this.mantenimientoModel.countDocuments({ estado });
  }
  async getProgrammedMaintenanceDates(): Promise<Date[]> {
    const mantenimientos = await this.mantenimientoModel
      .find({ estado: 'programado' })
      .exec();
    const fechas = [];
    for (const mantenimiento of mantenimientos) {
      const fecha = moment(mantenimiento.fecha)
        .tz('America/Lima')
        .startOf('day')
        .toDate();
      if (!fechas.find((f) => f.getTime() === fecha.getTime())) {
        fechas.push(fecha);
      }
    }
    return fechas;
  }

  async getCantidadMantenimientosPorEstadoYFecha(
    estado: string,
    fecha: Date,
  ): Promise<number> {
    // Obtener el inicio del día
    const inicioDia = new Date(fecha);
    inicioDia.setHours(0, 0, 0, 0);

    // Obtener el fin del día
    const finDia = new Date(fecha);
    finDia.setHours(23, 59, 59, 999);

    // Realizar la consulta
    return this.mantenimientoModel.countDocuments({
      estado,
      fecha: {
        $gte: inicioDia,
        $lte: finDia,
      },
    });
  }

  async getMantenimientosPorEstadoYFecha(
    estado: string,
    fecha: Date,
  ): Promise<Mantenimiento[]> {
    const startOfDay = new Date(fecha);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(fecha);
    endOfDay.setHours(23, 59, 59, 999);

    return this.mantenimientoModel.find({
      estado,
      fecha: {
        $gte: startOfDay,
        $lte: endOfDay,
      },
    });
  }

  async getMantenimientoPorId(id: string): Promise<Mantenimiento> {
    return this.mantenimientoModel.findById(id).exec();
  }

  async programar(
    programarManteniminetoDto: PrograMantenimientoDto,
  ): Promise<Mantenimiento> {
    const existsCarDto: ExistsCarDto = {
      placa: programarManteniminetoDto.placa,
    };
    const exists = await this.carsService.exists(existsCarDto);
    if (!exists) {
      throw new NotFoundException('Carro no existe');
    }

    const programMant = await this.mantenimientoModel.create({
      ...programarManteniminetoDto,
      estado: 'programado',
    });
    const mantToday = await this.getMantAPartirDeHoy();
    const allMantenimientos = await this.getMantenimientosDeHoy();
    const calendar = await this.getProgrammedMaintenanceCount();
    pubSub.publish('calendarTecnico', {
      calendarTecnico: { calendar, mantenimientos: allMantenimientos },
    });
    pubSub.publish('Actividades', { Actividades: mantToday });
    await this.notificacionesService.crearNotificacion(
      'admin',
      'mantenimiento',
      programMant.id.toString(),
      'Mantenimiento programado',
      `Se ha programado un mantenimiento para el vehículo con placa ${programMant.placa}`,
      new Date(),
      false,
    );
    return programMant.id.toString();
  }

  async registrar(
    updateMantDto: UpdateMantenimientoDto,
  ): Promise<Mantenimiento> {
    if (updateMantDto.repuestos.length === 0) {
      throw new BadRequestException('La matriz de repuestos está vacía');
    }
    //Verificar que no haya repuestos duplicados
    const repuestoIds = updateMantDto.repuestos.map((repuesto) => repuesto.id);
    const uniqueRepuestoIds = [...new Set(repuestoIds)];
    if (repuestoIds.length !== uniqueRepuestoIds.length) {
      throw new BadRequestException(
        'La matriz de repuestos contiene duplicados',
      );
    }
    const session = await this.mantenimientoModel.db.startSession();
    session.startTransaction();
    try {
      const mantenimiento = await this.mantenimientoModel
        .findById(updateMantDto._id)
        .session(session);
      if (!mantenimiento) {
        throw new NotFoundException(
          `Mantenimiento with ID ${updateMantDto._id} not found`,
        );
      }

      const repuestos = updateMantDto.repuestos.map((repuesto: any) => ({
        id: repuesto.id,
        marca: repuesto.marca,
        producto: repuesto.producto,
        cantidad: Number(repuesto.cantidad),
      }));

      const verifyRepuestoDto: VerifyRepuestoDto = { repuestos };

      const canProceed = await this.repuestosService.verify(
        verifyRepuestoDto,
        session,
      );

      if (!canProceed) {
        throw new BadRequestException('Repuestos verification failed');
      }

      const updateMant = await this.mantenimientoModel.findByIdAndUpdate(
        updateMantDto._id,
        {
          ...updateMantDto,
          estado: 'pendiente',
        },
        { new: true, session },
      );
      // Obtener la placa del carro del mantenimiento
      const placa = mantenimiento.placa;

      const updateKmDto = {
        placa,
        kmActual: updateMantDto.kmMedido,
      };
      await this.carsService.updateKm(updateKmDto);
      await session.commitTransaction();
      const mantToday = await this.getMantAPartirDeHoy();
      const allMantenimientos = await this.getMantenimientosDeHoy();
      const calendar = await this.getProgrammedMaintenanceCount();
      pubSub.publish('calendarTecnico', {
        calendarTecnico: { calendar, mantenimientos: allMantenimientos },
      });
      pubSub.publish('Actividades', { Actividades: mantToday });
      await this.notificacionesService.crearNotificacion(
        'admin',
        'mantenimiento',
        updateMant.id.toString(),
        'Mantenimiento Registrado',
        `Se ha registrado un mantenimiento para el vehículo con placa ${updateMant.placa}`,
        new Date(),
        false,
      );
      return updateMant.id.toString(); //Enviamos el ID como string
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  async registrarNuevo(
    updateOneMantDto: UpdateOneMantenimientoDto,
  ): Promise<Mantenimiento> {
    const existsCarDto: ExistsCarDto = { placa: updateOneMantDto.placa };
    const exists = await this.carsService.exists(existsCarDto);
    if (!exists) {
      throw new NotFoundException('Carro no existe');
    }
    // If the repuestos array is empty, return a response immediately
    if (updateOneMantDto.repuestos.length === 0) {
      throw new BadRequestException('La matriz de repuestos está vacía');
    }
    //Verificar que no haya repuestos duplicados
    const repuestoIds = updateOneMantDto.repuestos.map(
      (repuesto) => repuesto.id,
    );
    const uniqueRepuestoIds = [...new Set(repuestoIds)];
    if (repuestoIds.length !== uniqueRepuestoIds.length) {
      throw new BadRequestException(
        'La matriz de repuestos contiene duplicados',
      );
    }
    const session = await this.mantenimientoModel.db.startSession();
    session.startTransaction();
    try {
      const repuestos = updateOneMantDto.repuestos.map((repuesto: any) => ({
        id: repuesto.id,
        //cantidadReserva: Number(repuesto.cantidadReserva),
        marca: repuesto.marca,
        producto: repuesto.producto,
        cantidad: Number(repuesto.cantidad),
        // precio: Number(repuesto.precio),
      }));

      const verifyRepuestoDto: VerifyRepuestoDto = { repuestos };

      const canProceed = await this.repuestosService.verify(
        verifyRepuestoDto,
        session,
      );
      if (!canProceed) {
        throw new BadRequestException('Repuestos verification failed');
      }
      const [updateOneMant] = await this.mantenimientoModel.create(
        [
          {
            ...updateOneMantDto,
            estado: 'pendiente',
          },
        ],
        { new: true, session },
      );

      // Actualizar kmActual después de que todas las demás operaciones se hayan completado con éxito
      const updateKmDto = {
        placa: updateOneMantDto.placa,
        kmActual: updateOneMantDto.kmMedido,
      };
      await this.carsService.updateKm(updateKmDto);
      await session.commitTransaction();
      const mantToday = await this.getMantAPartirDeHoy();
      const allMantenimientos = await this.getMantenimientosDeHoy();
      const calendar = await this.getProgrammedMaintenanceCount();
      pubSub.publish('calendarTecnico', {
        calendarTecnico: { calendar, mantenimientos: allMantenimientos },
      });
      pubSub.publish('Actividades', { Actividades: mantToday });
      await this.notificacionesService.crearNotificacion(
        'admin',
        'mantenimiento',
        updateOneMant.id.toString(),
        'Mantenimiento Registrado',
        `Se ha registrado un mantenimiento para el vehículo con placa ${updateOneMant.placa}`,
        new Date(),
        false,
      );
      return updateOneMant.id.toString();
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  async filtrarMantenimientosPorPlaca(
    placa: string,
  ): Promise<MantenimientoDocument[]> {
    return this.mantenimientoModel.find({ placa }).exec();
  }

  async getInfoByPlaca(placa: string): Promise<any[]> {
    const mantenimientos = await this.filtrarMantenimientosPorPlaca(placa);
    return mantenimientos.map((mantenimiento) => ({
      id: mantenimiento._id,
      fecha: mantenimiento.fecha,
      tipo: mantenimiento.tipo,
      repuestosUsados: mantenimiento.repuestos.length,
    }));
  }

  async findInfoForPlaca(existsCarDto: ExistsCarDto): Promise<CarInfoDto> {
    const car = await this.carsService.findCarInfo(existsCarDto);
    const mantenimientos = await this.getInfoByPlaca(car.placa);

    return {
      id: car._id,
      placa: car.placa,
      fechaSoat: car.fechaSoat,
      vigenciaContrato: car.vigenciaContrato,
      cliente: car.cliente,
      tipoContrato: car.tipoContrato,
      propietario: car.propietario,
      kmRegistroInicial: car.kmRegistroInicial,
      kmActual: car.kmActual,
      Puntaje: car.puntaje,
      Mantenimientos: mantenimientos,
    };
  }

  async revision(
    id: string,
    cambiosSolicitados: string,
  ): Promise<Mantenimiento> {
    const session = await this.mantenimientoModel.db.startSession();
    session.startTransaction();
    try {
      const mantenimiento = await this.mantenimientoModel
        .findById(id)
        .session(session);
      if (!mantenimiento) {
        throw new NotFoundException(`Mantenimiento with ID ${id} not found`);
      }

      const repuestos = mantenimiento.repuestos
        .filter((repuesto: any) => repuesto.id)
        .map((repuesto: any) => ({
          id: repuesto.id,
          marca: repuesto.marca,
          producto: repuesto.producto,
          cantidad: repuesto.cantidad,
        }));

      const verifyRepuestoDto: VerifyRepuestoDto = { repuestos };

      const canProceed = await this.repuestosService.correctRevi(
        verifyRepuestoDto,
        session,
      );

      if (!canProceed) {
        throw new BadRequestException('Repuestos correction failed');
      }

      mantenimiento.estado = 'revision';
      mantenimiento.cambiosSolicitados = cambiosSolicitados;
      const updatedMant = await mantenimiento.save({ session });

      await session.commitTransaction();

      const mantToday = await this.getMantAPartirDeHoy();
      const allMantenimientos = await this.getMantenimientosDeHoy();
      const calendar = await this.getProgrammedMaintenanceCount();
      pubSub.publish('calendarTecnico', {
        calendarTecnico: { calendar, mantenimientos: allMantenimientos },
      });
      pubSub.publish('Actividades', { Actividades: mantToday });
      await this.notificacionesService.crearNotificacion(
        'tecnico',
        'mantenimiento',
        updatedMant.id.toString(),
        'Mantenimiento en Revisión',
        `Se han solicitado correciones en el mantenimiento a realizar al vehículo con placa ${updatedMant.placa}`,
        new Date(),
        false,
      );
      return updatedMant;
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  async deny(id: string, cambiosSolicitados: string): Promise<Mantenimiento> {
    const session = await this.mantenimientoModel.db.startSession();
    session.startTransaction();
    try {
      const mantenimiento = await this.mantenimientoModel
        .findById(id)
        .session(session);
      if (!mantenimiento) {
        throw new NotFoundException(`Mantenimiento with ID ${id} not found`);
      }

      const repuestos = mantenimiento.repuestos
        .filter((repuesto: any) => repuesto.id)
        .map((repuesto: any) => ({
          id: repuesto.id,
          marca: repuesto.marca,
          producto: repuesto.producto,
          cantidad: repuesto.cantidad,
        }));

      const verifyRepuestoDto: VerifyRepuestoDto = { repuestos };

      const canProceed = await this.repuestosService.correctRevi(
        verifyRepuestoDto,
        session,
      );

      if (!canProceed) {
        throw new BadRequestException('Repuestos correction failed');
      }

      mantenimiento.estado = 'denegado'; // Cambiado a 'denegado'
      mantenimiento.cambiosSolicitados = cambiosSolicitados;
      const updatedMant = await mantenimiento.save({ session });

      await session.commitTransaction();

      const mantToday = await this.getMantAPartirDeHoy();
      const allMantenimientos = await this.getMantenimientosDeHoy();
      const calendar = await this.getProgrammedMaintenanceCount();
      pubSub.publish('calendarTecnico', {
        calendarTecnico: { calendar, mantenimientos: allMantenimientos },
      });
      pubSub.publish('Actividades', { Actividades: mantToday });
      await this.notificacionesService.crearNotificacion(
        'tecnico',
        'mantenimiento',
        updatedMant.id.toString(),
        'Mantenimiento Denegado',
        `Se ha denagado el mantenimiento para el vehículo con placa ${updatedMant.placa}`,
        new Date(),
        false,
      );
      return updatedMant;
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  async Aprobado(id: string): Promise<Mantenimiento> {
    const session = await this.mantenimientoModel.db.startSession();
    session.startTransaction();
    try {
      const mantenimiento = await this.mantenimientoModel
        .findById(id)
        .session(session);
      if (!mantenimiento) {
        throw new NotFoundException(`Mantenimiento with ID ${id} not found`);
      }

      mantenimiento.estado = 'aprobado'; // Cambiado a 'denegado'
      const updatedMant = await mantenimiento.save({ session });

      await session.commitTransaction();

      const mantToday = await this.getMantAPartirDeHoy();
      const allMantenimientos = await this.getMantenimientosDeHoy();
      const calendar = await this.getProgrammedMaintenanceCount();
      pubSub.publish('calendarTecnico', {
        calendarTecnico: { calendar, mantenimientos: allMantenimientos },
      });
      pubSub.publish('Actividades', { Actividades: mantToday });
      await this.notificacionesService.crearNotificacion(
        'tecnico',
        'mantenimiento',
        updatedMant.id.toString(),
        'Mantenimiento Aprobado',
        `Se ha aprobado el mantenimiento para el vehículo con placa ${updatedMant.placa}`,
        new Date(),
        false,
      );
      return updatedMant;
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  async completarMantenimiento(
    id: string,
    diagnosticoFinal: string,
    fechaFin: Date,
  ): Promise<string> {
    const session = await this.mantenimientoModel.db.startSession();
    session.startTransaction();
    try {
      const mantenimiento = await this.mantenimientoModel
        .findById(id)
        .session(session);
      if (!mantenimiento) {
        throw new NotFoundException(`Mantenimiento with ID ${id} not found`);
      }

      const repuestos = mantenimiento.repuestos
        .filter((repuesto: any) => repuesto.id)
        .map((repuesto: any) => ({
          id: repuesto.id,
          marca: repuesto.marca,
          producto: repuesto.producto,
          cantidad: repuesto.cantidad,
        }));

      const verifyRepuestoDto: VerifyRepuestoDto = { repuestos };
      const canProceed = await this.repuestosService.finalizarRep(
        verifyRepuestoDto,
        session,
      );
      if (!canProceed) {
        throw new BadRequestException('Repuestos correction failed');
      }
      mantenimiento.estado = 'completado';
      mantenimiento.fechaFin = fechaFin;
      mantenimiento.diagnosticoFinal = diagnosticoFinal;
      const updatedMant = await mantenimiento.save({ session });
      await session.commitTransaction();

      const mantToday = await this.getMantAPartirDeHoy();
      const allMantenimientos = await this.getMantenimientosDeHoy();
      const calendar = await this.getProgrammedMaintenanceCount();
      pubSub.publish('calendarTecnico', {
        calendarTecnico: { calendar, mantenimientos: allMantenimientos },
      });
      pubSub.publish('Actividades', { Actividades: mantToday });

      await this.notificacionesService.crearNotificacion(
        'admin',
        'mantenimiento',
        updatedMant.id.toString(),
        'Mantenimiento Completado',
        `Se ha completado el mantenimiento para el vehículo con placa ${updatedMant.placa}`,
        new Date(),
        false,
      );

      return updatedMant.id.toString();
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  async getMantenimientosExceptoEstado(
    estado: string,
  ): Promise<Mantenimiento[]> {
    return this.mantenimientoModel.find({ estado: { $ne: estado } }).exec();
  }

  async getMantenimientosDeHoy(): Promise<Mantenimiento[]> {
    const startOfToday = new Date();
    startOfToday.setDate(startOfToday.getDate() - 7); // Resta 7 días a la fecha actual
    startOfToday.setHours(0, 0, 0, 0);

    console.log('Fecha del servidor: ', new Date());
    console.log('Inicio del día: ', startOfToday);

    const mantenimientos = await this.mantenimientoModel
      .find({
        fecha: { $gte: startOfToday },
        estado: { $nin: ['expirado' /*, 'completado'*/] },
      })
      .exec();

    // Asegurarse de que siempre se devuelva un array
    return mantenimientos || [];
  }
  async getCalendarHome(): Promise<[number, number]> {
    const today = new Date();
    const cantidadProgramada =
      await this.getCantidadMantenimientosPorEstadoYFecha('programada', today);
    const cantidadPendiente =
      await this.getCantidadMantenimientosPorEstadoYFecha('pendiente', today);
    const cantidadRevision =
      await this.getCantidadMantenimientosPorEstadoYFecha('revision', today);
    const cantidadCompletada =
      await this.getCantidadMantenimientosPorEstadoYFecha('completado', today);
    const cantidadTotal =
      cantidadCompletada +
      cantidadPendiente +
      cantidadRevision +
      cantidadProgramada;
    return [cantidadProgramada, cantidadTotal];
  }

  checkUniqueRepuesto(repuestos: RepuestoDto[]) {
    const uniqueRepuestoIds = new Set(repuestos.map((repuesto) => repuesto.id));
    if (uniqueRepuestoIds.size !== repuestos.length) {
      throw new BadRequestException('Los repuestos deben ser únicos');
    }
  }

  async getProgrammedMaintenanceCount(): Promise<
    { dayMes: string; cantidad: number }[]
  > {
    const today = new Date();
    const twoMonthsLater = new Date();
    twoMonthsLater.setMonth(today.getMonth() + 2);

    const mantenimientos = await this.mantenimientoModel
      .find({
        estado: 'programado',
        fecha: {
          $gte: today,
          $lte: twoMonthsLater,
        },
      })
      .exec();

    const counts = mantenimientos.reduce((acc, mantenimiento) => {
      const dayMes = mantenimiento.fecha.toISOString().split('T')[0]; // Formatea la fecha a 'YYYY-MM-DD'
      if (!acc[dayMes]) {
        acc[dayMes] = 0;
      }
      acc[dayMes]++;
      return acc;
    }, {});

    return Object.entries(counts).map(([dayMes, cantidad]) => ({
      dayMes: dayMes.split('-').reverse().join('/'), // Cambia el formato de 'YYYY-MM-DD' a 'DD/MM/YYYY'
      cantidad: Number(cantidad),
    }));
  }

  async getMantAPartirDeHoy(): Promise<Mantenimiento[]> {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    // console.log('Fecha del servidor: ', new Date());
    // console.log('Inicio del día: ', startOfToday);

    const mantenimientos = await this.mantenimientoModel
      .find({
        fecha: { $gte: startOfToday },
        estado: { $nin: ['expirado' /*, 'completado'*/] },
      })
      .exec();

    //consoleg.log('Mantenimientos encontrados: ', mantenimientos);

    // Asegurarse de que siempre se devuelva un array
    return mantenimientos || [];
  }

  async getConsumedRepuestos(inputDate: Date, months: number): Promise<any> {
    console.log('inputDate:', inputDate);
    console.log('months:', months);
    const startDate = new Date(
      inputDate.getFullYear(),
      inputDate.getMonth() + 1,
      0,
    );
    startDate.setHours(23, 59, 59, 999); // Set the time to the end of the day
    console.log('startDate:', startDate);
    const endDate = new Date(
      inputDate.getFullYear(),
      inputDate.getMonth() - months,
      1,
    );
    endDate.setHours(0, 0, 0, 0); // Set the time to the start of the day
    console.log('endDate:', endDate);
    const mantenimientos = await this.mantenimientoModel.aggregate([
      {
        $match: {
          fecha: { $gte: endDate, $lte: startDate },
          estado: 'completado',
        },
      },
      {
        $unwind: '$repuestos',
      },
      {
        $group: {
          _id: {
            month: { $month: '$fecha' },
            year: { $year: '$fecha' },
            producto: '$repuestos.producto',
          },
          cantidadConsumida: { $sum: '$repuestos.cantidad' },
        },
      },
      {
        $sort: { cantidadConsumida: -1 },
      },
    ]);
    console.log('mantenimientos:', mantenimientos);
    const results = [];
    for (const mant of mantenimientos) {
      const key = `${mant._id.month}/${mant._id.year}`;
      let monthData = results.find((item) => item.mesYear === key);
      if (!monthData) {
        monthData = {
          mesYear: key,
          otros: { producto: 'otros', cantidadConsumida: 0 },
        };
        results.push(monthData);
      }
      if (Object.keys(monthData).length <= 6) {
        monthData[`prod${Object.keys(monthData).length - 1}`] = {
          producto: mant._id.producto,
          cantidadConsumida: mant.cantidadConsumida,
        };
      } else {
        monthData.otros.cantidadConsumida += mant.cantidadConsumida;
      }
    }

    return results || [];
  }

  async addRepuestosAjuste(
    id: string,
    repuestosAjusteDto: CreateRepuestoAjusteDto[],
  ): Promise<MantenimientoDocument> {
    const mantenimiento = await this.mantenimientoModel.findById(id);
    if (!mantenimiento) {
      throw new Error('Mantenimiento no encontrado');
    }

    mantenimiento.repuestosAjuste = repuestosAjusteDto.map((dto) => {
      return {
        _id: dto.id,
        marca: dto.marca,
        producto: dto.producto,
        cantidad: dto.cantidad,
        precio: dto.precio,
      };
    });

    return await mantenimiento.save();
  }

  //Estadisticas
  async getKmRecorridoPorMes(
    placa: string,
    fecha: Date,
  ): Promise<KmRecorridoPorMes[]> {
    const oneYearAgo = new Date(fecha);
    oneYearAgo.setMonth(oneYearAgo.getMonth() - 12);

    const mantenimientos = await this.mantenimientoModel.find({
      placa,
      estado: 'completado',
      fecha: { $gte: oneYearAgo, $lte: fecha },
    });

    const kmRecorridoPorMes = Array(12)
      .fill(0)
      .map((_, index) => {
        const year =
          oneYearAgo.getFullYear() +
          Math.floor((oneYearAgo.getMonth() + index + 1) / 12);
        const month = (oneYearAgo.getMonth() + index + 1) % 12;

        const kmRecorridoTotal = mantenimientos
          .filter((mantenimiento) => {
            const mantenimientoDate = new Date(mantenimiento.fecha);
            return (
              mantenimientoDate.getMonth() === month &&
              mantenimientoDate.getFullYear() === year
            );
          })
          .reduce(
            (total, mantenimiento) =>
              total + (mantenimiento.kmMedido - mantenimiento.kmPrevio),
            0,
          );

        return {
          mes: `${month + 1}/${year}`,
          kmRecorridoTotal,
        };
      });

    return kmRecorridoPorMes;
  }

  async getCostos(placa: string, fecha: Date): Promise<Costos> {
    const startOfMonth = new Date(fecha.getFullYear(), fecha.getMonth(), 1);
    const endOfMonth = new Date(fecha.getFullYear(), fecha.getMonth() + 1, 0);
    const startOfLastMonth = new Date(
      fecha.getFullYear(),
      fecha.getMonth() - 1,
      1,
    );
    const endOfLastMonth = new Date(fecha.getFullYear(), fecha.getMonth(), 0);

    const mantenimientos = await this.mantenimientoModel
      .find({
        placa,
        estado: 'completado',
        fecha: { $gte: startOfLastMonth, $lte: endOfMonth },
      })
      .populate('repuestosAjuste');

    const calculateCost = (mantenimientos: Mantenimiento[]) =>
      mantenimientos.reduce(
        (total, mantenimiento) =>
          total +
          mantenimiento.repuestosAjuste.reduce(
            (total, repuesto) => total + repuesto.cantidad * repuesto.precio,
            0,
          ),
        0,
      );

    const mantenimientosThisMonth = mantenimientos.filter(
      (mantenimiento) =>
        mantenimiento.fecha >= startOfMonth &&
        mantenimiento.fecha <= endOfMonth,
    );
    const mantenimientosLastMonth = mantenimientos.filter(
      (mantenimiento) =>
        mantenimiento.fecha >= startOfLastMonth &&
        mantenimiento.fecha <= endOfLastMonth,
    );

    const costoTotal = calculateCost(mantenimientosThisMonth);
    const costoPreventivos = calculateCost(
      mantenimientosThisMonth.filter(
        (mantenimiento) => mantenimiento.tipo === 'Mantenimiento Preventivo',
      ),
    );
    const costoCorrectivos = calculateCost(
      mantenimientosThisMonth.filter(
        (mantenimiento) => mantenimiento.tipo === 'Mantenimiento Correctivo',
      ),
    );
    const costoMesPasado = calculateCost(mantenimientosLastMonth);

    return { costoTotal, costoPreventivos, costoCorrectivos, costoMesPasado };
  }

  async getNumeroMantenimientos(placa: string, fecha: Date): Promise<number> {
    const startOfMonth = new Date(fecha.getFullYear(), fecha.getMonth(), 1);
    const endOfMonth = new Date(fecha.getFullYear(), fecha.getMonth() + 1, 0);

    const mantenimientos = await this.mantenimientoModel.countDocuments({
      placa,
      estado: 'completado',
      fecha: { $gte: startOfMonth, $lte: endOfMonth },
    });

    return mantenimientos;
  }
  async getNumeroMantCance(placa: string, fecha: Date): Promise<number> {
    const startOfMonth = new Date(fecha.getFullYear(), fecha.getMonth(), 1);
    const endOfMonth = new Date(fecha.getFullYear(), fecha.getMonth() + 1, 0);

    const mantenimientos = await this.mantenimientoModel.countDocuments({
      placa,
      estado: 'denegado',
      fecha: { $gte: startOfMonth, $lte: endOfMonth },
    });

    return mantenimientos;
  }

  async getRepuestosMasConsumidos(
    placa: string,
    fecha: Date,
  ): Promise<RepuestosMasConsumidosPorMes> {
    const mantenimientos = await this.mantenimientoModel
      .find({
        placa,
        estado: 'completado',
        fecha: {
          $gte: new Date(fecha.getFullYear(), fecha.getMonth(), 1),
          $lte: fecha,
        },
      })
      .populate('repuestosAjuste');

    const repuestos = mantenimientos.flatMap((mantenimiento) =>
      mantenimiento.repuestosAjuste.map((repuesto) => ({
        producto: repuesto.producto,
        costo: repuesto.cantidad * repuesto.precio,
      })),
    );

    const repuestosGrouped = repuestos.reduce(
      (grouped, repuesto) => {
        grouped[repuesto.producto] =
          (grouped[repuesto.producto] || 0) + repuesto.costo;
        return grouped;
      },
      {} as Record<string, number>,
    );

    const repuestosSorted = Object.entries(repuestosGrouped)
      .map(([producto, costo]) => ({ producto, costo: costo as number }))
      .sort((a, b) => b.costo - a.costo);

    const [repuesto1, repuesto2, repuesto3, repuesto4, ...otrosRepuestos] =
      repuestosSorted;

    const otros = otrosRepuestos.reduce(
      (total, repuesto) => total + (repuesto.costo as number),
      0,
    );

    return {
      mes: `${fecha.getMonth() + 1}/${fecha.getFullYear()}`,
      repuesto1: repuesto1 || { producto: '-', costo: 0 },
      repuesto2: repuesto2 || { producto: '-', costo: 0 },
      repuesto3: repuesto3 || { producto: '-', costo: 0 },
      repuesto4: repuesto4 || { producto: '-', costo: 0 },
      otros: otros || 0,
    };
  }

  async getOperatividadPorMes(
    placa: string,
    fecha: Date,
  ): Promise<OperatividadPorMes[]> {
    const oneYearAgo = new Date(fecha);
    oneYearAgo.setMonth(oneYearAgo.getMonth() - 12);

    const mantenimientos = await this.mantenimientoModel.find({
      placa,
      estado: 'completado',
      fecha: { $gte: oneYearAgo, $lte: fecha },
    });

    const operatividadPorMes = Array(12)
      .fill(0)
      .map((_, index) => {
        const year =
          oneYearAgo.getFullYear() +
          Math.floor((oneYearAgo.getMonth() + index + 1) / 12);
        const month = (oneYearAgo.getMonth() + index + 1) % 12;

        const mantenimientosThisMonth = mantenimientos.filter(
          (mantenimiento) => {
            const mantenimientoDate = new Date(mantenimiento.fecha);
            return (
              mantenimientoDate.getMonth() === month &&
              mantenimientoDate.getFullYear() === year
            );
          },
        );

        const horasMuertas = mantenimientosThisMonth.reduce(
          (total, mantenimiento) => {
            const inicio = new Date(mantenimiento.fechaInicio);
            const fin = new Date(mantenimiento.fechaFin);
            const horas = (fin.getTime() - inicio.getTime()) / 1000 / 60 / 60;
            return total + horas;
          },
          0,
        );

        const horasDelMes = new Date(year, month + 1, 0).getDate() * 24;

        const operatividad = parseFloat(
          (horasDelMes - horasMuertas).toFixed(2),
        );

        return {
          mes: `${month + 1}/${year}`,
          operatividad,
        };
      });

    return operatividadPorMes;
  }

  // Mantenimientos por placas(matriz) y rango de fechas
  async findByPlatesAndDateRange(
    placas: string[],
    fechaDesde: Date,
    fechaHasta: Date,
  ): Promise<Mantenimiento[]> {
    return this.mantenimientoModel
      .find({
        placa: { $in: placas },
        fechaInicio: { $gte: fechaDesde, $lte: fechaHasta },
        estado: 'completado',
      })
      .exec();
  }

  //Operatividad total por vehículo
  async getOperatividadPorcentual(placa: string): Promise<number> {
    const mantenimientos = await this.mantenimientoModel.find({
      placa,
      estado: 'completado',
    });
    if (mantenimientos.length === 0) {
      console.log(
        'No se encontraron mantenimientos completados para la placa especificada',
      );
      return 0;
    }

    const horasMuertas = mantenimientos.reduce((total, mantenimiento) => {
      const inicio = new Date(mantenimiento.fechaInicio);
      const fin = new Date(mantenimiento.fechaFin);
      const horas = (fin.getTime() - inicio.getTime()) / 1000 / 60 / 60;
      return total + horas;
    }, 0);

    const primerMantenimiento = mantenimientos[0];
    const ahora = new Date();
    const horasTotales =
      (ahora.getTime() - new Date(primerMantenimiento.fechaInicio).getTime()) /
      1000 /
      60 /
      60;

    const operatividad = horasTotales - horasMuertas;
    const operatividadPorcentual = operatividad / horasTotales;

    return operatividadPorcentual;
  }

  //Operatividad total por vehículo
  async getOperatividadHoras(placa: string): Promise<number> {
    const mantenimientos = await this.mantenimientoModel.find({
      placa,
      estado: 'completado',
    });
    if (mantenimientos.length === 0) {
      console.log(
        'No se encontraron mantenimientos completados para la placa especificada',
      );
      return 0;
    }

    const horasMuertas = mantenimientos.reduce((total, mantenimiento) => {
      const inicio = new Date(mantenimiento.fechaInicio);
      const fin = new Date(mantenimiento.fechaFin);
      const horas = (fin.getTime() - inicio.getTime()) / 1000 / 60 / 60;
      return total + horas;
    }, 0);

    const primerMantenimiento = mantenimientos[0];
    const ahora = new Date();
    const horasTotales =
      (ahora.getTime() - new Date(primerMantenimiento.fechaInicio).getTime()) /
      1000 /
      60 /
      60;

    const operatividad = horasTotales - horasMuertas;

    return operatividad;
  }

  // async getCarData(searchParam: string): Promise<any> {
  //   const car = await this.carsService.findFirstByPlaca(searchParam);
  //   if (!car) {
  //     return {};
  //   }

  //   const fechaSoat = car.fechaSoat;
  //   const vigenciaContrato = car.vigenciaContrato;
  //   const kmActual = car.kmActual;
  //   const cliente = await this.carsService.getCliente(car.placa);

  //   const mantenimientos = await this.mantenimientoModel
  //     .find({
  //       placa: car.placa,
  //       estado: 'completado',
  //     })
  //     .sort({ fecha: -1 });

  //   const ultimaRevision =
  //     mantenimientos.length > 0 ? mantenimientos[0].fecha : null;

  //   const operatividad = await this.getOperatividadPorcentual(car.placa);

  //   return {
  //     placa: car.placa,
  //     fechaSoat,
  //     cliente,
  //     ultimaRevision,
  //     vigenciaContrato,
  //     kmActual,
  //     operatividad,
  //   };
  // }

  async getCarData(searchParam: string, cliente: string): Promise<any> {
    const car = await this.carsService.findFirstByPlacaForClient(
      searchParam,
      cliente,
    );
    if (!car) {
      return {};
    }

    const fechaSoat = car.fechaSoat;
    const vigenciaContrato = car.vigenciaContrato;
    const kmActual = car.kmActual;
    const clienteData = await this.carsService.getCliente(car.placa);

    const mantenimientos = await this.mantenimientoModel
      .find({
        placa: car.placa,
        estado: 'completado',
      })
      .sort({ fecha: -1 });

    const ultimaRevision =
      mantenimientos.length > 0 ? mantenimientos[0].fecha : null;

    const operatividad = await this.getOperatividadPorcentual(car.placa);

    return {
      placa: car.placa,
      fechaSoat,
      cliente: clienteData,
      ultimaRevision,
      vigenciaContrato,
      kmActual,
      operatividad,
    };
  }

  async searchMantenimientos(
    cliente: string,
    fechaInicio?: Date | null,
    fechaTermino?: Date | null,
    placa?: string,
    page?: number,
  ) {
    const query = {};
    const limit = 6;
    // Obtiene las placas asociadas al cliente
    const placasCliente = await this.carsService.findPlatesByClient(cliente);

    // Agrega esta línea para buscar solo mantenimientos completados
    query['estado'] = 'completado';

    // Si se proporciona una placa, se busca una placa que coincida con
    // el parámetro o que esté en la lista de placas asociadas al cliente
    if (placa) {
      query['placa'] = {
        $or: [{ $regex: new RegExp(placa, 'i') }, { $in: placasCliente }],
      };
    } else {
      query['placa'] = { $in: placasCliente };
    }

    query['placa'] = { $in: placasCliente };

    if (fechaInicio != null) {
      query['fechaFin'] = { $gte: fechaInicio };
    }

    if (fechaTermino != null) {
      if (query['fechaFin']) {
        query['fechaFin']['$lte'] = fechaTermino;
      } else {
        query['fechaFin'] = { $lte: fechaTermino };
      }
    }

    const totalDocuments = await this.mantenimientoModel.countDocuments(query);
    const totalPages = Math.ceil(totalDocuments / limit);

    const skip = page > 0 ? (page - 1) * limit : 0;

    const mantenimientos = await this.mantenimientoModel
      .find(query)
      .skip(skip)
      .limit(limit)
      .exec();

    return {
      totalPages,
      mantenimientos: await Promise.all(
        mantenimientos.map(async (mantenimiento) => {
          const repuestoUsados = mantenimiento.repuestosAjuste.length;
          const costoRepuestos = mantenimiento.repuestosAjuste.reduce(
            (sum, repuesto) => sum + repuesto.cantidad * repuesto.precio,
            0,
          );
          const cliente = await this.carsService.getCliente(
            mantenimiento.placa,
          );

          return {
            _id: mantenimiento._id,
            placa: mantenimiento.placa,
            cliente,
            fechaInicio: mantenimiento.fechaInicio,
            fechaFin: mantenimiento.fechaFin || null,
            tipo: mantenimiento.tipo,
            repuestoUsados,
            costoRepuestos,
          };
        }),
      ),
    };
  }

  async getCalendarGraficaRange(inputDate: Date): Promise<CalendarGrafica[]> {
    const startDate = new Date(inputDate);
    startDate.setMonth(inputDate.getMonth() - 6);
    const endDate = new Date(inputDate);
    endDate.setMonth(inputDate.getMonth() + 6);

    const mantenimientos = await this.mantenimientoModel.aggregate([
      {
        $match: {
          estado: 'programado',
          fecha: { $gte: startDate, $lte: endDate },
        },
      },
      {
        $group: {
          _id: {
            day: { $dayOfMonth: '$fecha' },
            month: { $month: '$fecha' },
            year: { $year: '$fecha' },
          },
          count: { $sum: 1 },
        },
      },
    ]);
    return mantenimientos.map(({ _id, count }) => {
      const fecha = new Date(_id.year, _id.month - 1, _id.day);
      fecha.setHours(fecha.getHours() - 5);
      return {
        fecha,
        cantidad: count,
      };
    });
  }

  //Mantenimientos completados en x mes
  async getCompletedMaintenancesInMonth(date: Date): Promise<number> {
    const startOfMonth = new Date(date.getFullYear(), date.getMonth(), 1);
    const endOfMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0);

    const count = await this.mantenimientoModel.countDocuments({
      estado: 'completado',
      fecha: {
        $gte: startOfMonth,
        $lte: endOfMonth,
      },
    });

    return count;
  }

  //Mantenimientos cancelados en x mes
  async getDenegadosMaintenancesInMonth(date: Date): Promise<number> {
    const startOfMonth = new Date(date.getFullYear(), date.getMonth(), 1);
    const endOfMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0);

    const count = await this.mantenimientoModel.countDocuments({
      estado: 'denegado',
      fecha: {
        $gte: startOfMonth,
        $lte: endOfMonth,
      },
    });

    return count;
  }

  async getMostConsumedParts(date: Date): Promise<DashRepuestos> {
    const firstDayOfMonth = new Date(date.getFullYear(), date.getMonth(), 1);
    const lastDayOfMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0);

    const mostConsumedParts = await this.mantenimientoModel.aggregate([
      {
        $match: {
          fecha: { $gte: firstDayOfMonth, $lte: lastDayOfMonth },
          estado: 'completado',
        },
      },
      { $unwind: '$repuestosAjuste' },
      {
        $group: {
          _id: '$repuestosAjuste.producto',
          count: {
            $sum: {
              $multiply: [
                '$repuestosAjuste.cantidad',
                '$repuestosAjuste.precio',
              ],
            },
          },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 3 },
    ]);

    const dashRepuestos = new DashRepuestos();
    mostConsumedParts.forEach((part, index) => {
      const productoConsumido = new ProductoConsumidoDash();
      productoConsumido.producto = part._id;
      productoConsumido.cantidadConsumida = part.count;

      dashRepuestos[`prod${index + 1}`] = productoConsumido;
    });

    return dashRepuestos;
  }
}
