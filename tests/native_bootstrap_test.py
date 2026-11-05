# SPDX-License-Identifier: AGPL-3.0-only
import hashlib
import importlib.util
import io
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('bootstrap', Path(__file__).resolve().parents[1] / 'scripts/install-native.py')
bootstrap = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bootstrap)


class RuntimeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.prefix = 'node-v' + bootstrap.VERSION + '-linux-x64'

    def archive(self, extra=None):
        path = self.root / 'runtime.tar.xz'
        with tarfile.open(path, 'w:xz') as tar:
            for name in ['bin/node', 'lib/npm.js']:
                entry = tarfile.TarInfo(self.prefix + '/' + name)
                entry.size = 4
                entry.mode = 0o777
                tar.addfile(entry, io.BytesIO(b'test'))
            link = tarfile.TarInfo(self.prefix + '/bin/npm')
            link.type = tarfile.SYMTYPE
            link.linkname = '../lib/npm.js'
            tar.addfile(link)
            if extra:
                tar.addfile(extra)
        return path, hashlib.sha256(path.read_bytes()).hexdigest()

    def extract(self, path, digest):
        out = self.root / 'out'
        out.mkdir(exist_ok=True)
        return bootstrap.extract_runtime(path, out, 'x64', digest)

    def test_verified_runtime_retains_internal_npm_link_and_safe_modes(self):
        root = self.extract(*self.archive())
        self.assertEqual((root / 'bin/npm').read_bytes(), b'test')
        self.assertEqual((root / 'bin/node').stat().st_mode & 0o777, 0o755)

    def test_bad_hash_extracts_nothing(self):
        path, _ = self.archive()
        with self.assertRaisesRegex(ValueError, 'checksum_mismatch'):
            self.extract(path, '0' * 64)
        self.assertEqual(list((self.root / 'out').iterdir()), [])

    def test_path_and_link_escapes_and_devices_refused(self):
        for name, kind, target in [('../outside', tarfile.REGTYPE, ''),
                                   (self.prefix + '/escape', tarfile.SYMTYPE, '/etc/passwd'),
                                   (self.prefix + '/device', tarfile.CHRTYPE, '')]:
            entry = tarfile.TarInfo(name)
            entry.type, entry.linkname = kind, target
            with self.assertRaisesRegex(ValueError, 'unsafe'):
                self.extract(*self.archive(entry))
        self.assertFalse((self.root / 'outside').exists())

    def test_expansion_limit(self):
        with patch.object(bootstrap, 'MAX_EXPANDED', 1):
            with self.assertRaisesRegex(ValueError, 'too_large'):
                self.extract(*self.archive())

    def test_closed_and_malformed_readiness(self):
        record = dict(schemaVersion=1, ownerDecision='D-53', readyForOwnerInstallation=True,
                      ownerDeploymentConsentRecorded=True, checks={'test': True})
        bootstrap.require_ready(record)
        for changes in [{'checks': {}}, {'checks': {'test': 1}}, {'checks': {'test': False}},
                        {'ownerDeploymentConsentRecorded': False}, {'readyForOwnerInstallation': False}]:
            with self.assertRaisesRegex(ValueError, 'gate_closed'):
                bootstrap.require_ready({**record, **changes})

    def test_download_failure_leaves_no_target_or_staging(self):
        if __import__('os').geteuid() != 0:
            self.skipTest('root-owned runtime parent required')
        with patch.object(bootstrap, 'download_runtime', side_effect=ValueError('download_failed')):
            with self.assertRaisesRegex(ValueError, 'download_failed'):
                bootstrap.provision_runtime(self.root / 'node')
        self.assertEqual(list(self.root.iterdir()), [])

    def test_unrelated_existing_runtime_is_not_replaced(self):
        if __import__('os').geteuid() != 0:
            self.skipTest('root-owned runtime parent required')
        target = self.root / 'node'
        target.mkdir()
        (target / 'user-file').write_text('keep')
        with self.assertRaises(FileNotFoundError):
            bootstrap.provision_runtime(target)
        self.assertEqual((target / 'user-file').read_text(), 'keep')


if __name__ == '__main__':
    unittest.main()
