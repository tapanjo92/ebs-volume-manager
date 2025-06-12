'use client';

import { useState, useEffect } from 'react';
import apiClient from '@/services/api-client';

interface Volume {
  volumeId: string;
  size: number;
  volumeType: string;
  state: string;
  encrypted: boolean;
  createTime: string;
  attachments: any[];
  region: string;
}

export default function DashboardPage() {
  const [volumes, setVolumes] = useState<Volume[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadVolumes();
  }, []);

  const loadVolumes = async () => {
    try {
      setLoading(true);
      const data = await apiClient.getVolumes();
      setVolumes(data.volumes);
    } catch (err: any) {
      setError(err.message || 'Failed to load volumes');
    } finally {
      setLoading(false);
    }
  };

  const handleScan = async () => {
    try {
      // This would open a modal to input AWS account details
      // For now, using hardcoded values
      await apiClient.scanVolumes('123456789012');
      alert('Scan initiated successfully');
    } catch (err: any) {
      alert('Scan failed: ' + err.message);
    }
  };

  const handleBackup = async (volumeId: string) => {
    try {
      await apiClient.backupVolume(volumeId);
      alert('Backup initiated successfully');
    } catch (err: any) {
      alert('Backup failed: ' + err.message);
    }
  };

  if (loading) {
    return <div className="text-center py-4">Loading volumes...</div>;
  }

  if (error) {
    return <div className="text-red-600 text-center py-4">Error: {error}</div>;
  }

  return (
    <div className="px-4 sm:px-6 lg:px-8">
      <div className="sm:flex sm:items-center">
        <div className="sm:flex-auto">
          <h1 className="text-2xl font-semibold text-gray-900">EBS Volumes</h1>
          <p className="mt-2 text-sm text-gray-700">
            A list of all EBS volumes in your AWS accounts.
          </p>
        </div>
        <div className="mt-4 sm:mt-0 sm:ml-16 sm:flex-none">
          <button
            onClick={handleScan}
            className="inline-flex items-center justify-center rounded-md border border-transparent bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 sm:w-auto"
          >
            Scan AWS Account
          </button>
        </div>
      </div>
      
      <div className="mt-8 flex flex-col">
        <div className="-my-2 -mx-4 overflow-x-auto sm:-mx-6 lg:-mx-8">
          <div className="inline-block min-w-full py-2 align-middle md:px-6 lg:px-8">
            <div className="overflow-hidden shadow ring-1 ring-black ring-opacity-5 md:rounded-lg">
              <table className="min-w-full divide-y divide-gray-300">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                      Volume ID
                    </th>
                    <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                      Size (GB)
                    </th>
                    <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                      Type
                    </th>
                    <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                      State
                    </th>
                    <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                      Region
                    </th>
                    <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                      Attached
                    </th>
                    <th className="relative py-3.5 pl-3 pr-4 sm:pr-6">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white">
                  {volumes.map((volume) => (
                    <tr key={volume.volumeId}>
                      <td className="whitespace-nowrap px-3 py-4 text-sm font-medium text-gray-900">
                        {volume.volumeId}
                      </td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                        {volume.size}
                      </td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                        {volume.volumeType}
                      </td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                        <span
                          className={`inline-flex rounded-full px-2 text-xs font-semibold leading-5 ${
                            volume.state === 'available'
                              ? 'bg-green-100 text-green-800'
                              : 'bg-yellow-100 text-yellow-800'
                          }`}
                        >
                          {volume.state}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                        {volume.region}
                      </td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                        {volume.attachments.length > 0 ? 'Yes' : 'No'}
                      </td>
                      <td className="relative whitespace-nowrap py-4 pl-3 pr-4 text-right text-sm font-medium sm:pr-6">
                        <button
                          onClick={() => handleBackup(volume.volumeId)}
                          className="text-indigo-600 hover:text-indigo-900"
                        >
                          Backup
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
